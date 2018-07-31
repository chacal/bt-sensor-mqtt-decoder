import mqtt = require('mqtt')
import Bacon = require('baconjs')
import _ = require('lodash')
import Client = mqtt.Client
import btSensorDecode from './BTSensorDecoder'

const MQTT_BROKER = process.env.MQTT_BROKER ? process.env.MQTT_BROKER : 'mqtt://mqtt-home.chacal.fi'
const MQTT_USERNAME = process.env.MQTT_USERNAME || undefined
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || undefined
const MAX_DISCONNECT_COUNT = 20

const BUFFER_TIME_MS = 2000   // Coalesce events from each sensor this many ms and pass on only the one with the highest RSSI

const mqttClient = startMqttClient(MQTT_BROKER, MQTT_USERNAME, MQTT_PASSWORD)
mqttClient.subscribe('/bt-sensor-gw/+/value')

Bacon.fromEvent(mqttClient, 'message', (topic, msg) => msg)
  .flatMap(parseEventsFromBytes)
  .groupBy(event => event.tag + event.instance)
  .flatMap(groupedStream => {
    // Buffer events for each sensor for BUFFER_TIME_MS and select the one with the highest RSSI
    // This is done in order to avoid multiple events being generated even if the same radio packet is received by multiple
    // ESP-BT-MQTT gateways
    return groupedStream.slidingTimeWindow(BUFFER_TIME_MS)
      .debounce(BUFFER_TIME_MS)
      .map(latestEventsWithTs => latestEventsWithTs.map(e => e.value))
      .map(latestEvents => _.last(_.sortBy(latestEvents, 'rssi')))
  })
  .onValue(e => mqttClient.publish(`/sensor/${e.instance}/${e.tag}/state`, JSON.stringify(e), {retain: true, qos: 1}))


function parseEventsFromBytes(message) {
  try {
    const messageJson = JSON.parse(message)
    const sensorEvents = btSensorDecode(messageJson.data)
    return Bacon.fromArray(sensorEvents.map(e => Object.assign(e, {rssi: messageJson.rssi})))
  } catch(e) {
    console.error(`Got invalid MQTT message: ${message}`, e)
    return Bacon.fromArray([])
  }
}

function startMqttClient<A>(brokerUrl: string, username: string, password: string): Client {
  let disconnectCount = 0

  const client = mqtt.connect(brokerUrl, {username, password})
  client.on('connect', () => console.log('Connected to MQTT server'))
  client.on('offline', () => {
    disconnectCount++
    console.log(`Disconnected from MQTT server. Disconnect count: ${disconnectCount}/${MAX_DISCONNECT_COUNT}`)
    if(disconnectCount === MAX_DISCONNECT_COUNT) {
      console.log("Exiting due to too many MQTT disconnects..")
      process.exit(1)
    }
  })
  client.on('error', (e) => console.log('MQTT client error', e))

  return client
}


Bacon.Observable.prototype.slidingTimeWindow = function(windowDuration) {
  var addToWindow, now, withTimeStamp
  now = function() {
    return Date.now()
  }
  withTimeStamp = function(value) {
    return {
      value: value,
      timestamp: now()
    }
  }
  addToWindow = function(window, value) {
    window.push(value)
    var ref = window[0]
    while(ref != null && ref.timestamp < now() - windowDuration) {
      window = window.splice(1)
      ref = window[0]
    }
    return window
  }
  return this.map(withTimeStamp).scan([], addToWindow)
}
