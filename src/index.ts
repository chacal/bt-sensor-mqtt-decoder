import Bacon = require('baconjs')
import _ = require('lodash')
import btSensorDecode from './BTSensorDecoder'
import {Mqtt, SensorEvents} from '@chacal/js-utils'

declare module 'baconjs' {
  interface EventStream<E, A> {
    slidingTimeWindow<E, A>(windowLengthMs: number): Bacon.EventStream<E, Array<{ value: A, timestamp: number }>>;
  }
}


const MQTT_BROKER = process.env.MQTT_BROKER ? process.env.MQTT_BROKER : 'mqtt://mqtt-home.chacal.fi'
const MQTT_USERNAME = process.env.MQTT_USERNAME || undefined
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || undefined

const BUFFER_TIME_MS = 2000   // Coalesce events from each sensor this many ms and pass on only the one with the highest RSSI
const MESSAGE_COUNTER_WINDOW_SIZE = 10   // Remember this many latest message counters and publish new event only if its counter is not in the remembered list

const mqttClient = Mqtt.startMqttClient(MQTT_BROKER, MQTT_USERNAME, MQTT_PASSWORD)
mqttClient.subscribe('/bt-sensor-gw/+/value')


const allSensorEvents = Mqtt.messageStreamFrom(mqttClient).flatMap(parseEventsFromBytes)
const pirEvents = allSensorEvents.filter(SensorEvents.isPirEvent)
const currentEvents = allSensorEvents.filter(SensorEvents.isCurrent)
const otherEvents = allSensorEvents.filter(e => !SensorEvents.isPirEvent(e) && !SensorEvents.isCurrent(e))


currentEvents
  .groupBy(event => event.instance)
  .flatMap(streamFromOneInstance => streamFromOneInstance)
  .slidingWindow(MESSAGE_COUNTER_WINDOW_SIZE, 1)
  .onValue(events => {
    const newestMessageCounter = _.last(events).messageCounter
    const messageCounterCounts = _.countBy(events, 'messageCounter')
    // Publish event only if its message counter value occurs once in the latest counter values list (= the message has not been seen yet)
    if(messageCounterCounts[`${newestMessageCounter}`] === 1) {
      publishEvent(_.last(events))
    }
  })

// Publish PIR events immediately
pirEvents
  .groupBy(event => event.instance)
  .flatMap(streamFromOneInstance => streamFromOneInstance)
  .onValue(publishEvent)


// Buffer others for BUFFER_TIME_MS and publish the one with the highest RSSI
otherEvents
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
  .onValue(publishEvent)


function publishEvent(e: SensorEvents.ISensorEvent): void {
  mqttClient.publish(`/sensor/${e.instance}/${e.tag}/state`, JSON.stringify(e), {retain: true, qos: 1})
}


function parseEventsFromBytes(message): Bacon.EventStream<any, SensorEvents.ISensorEvent> {
  try {
    const messageJson = JSON.parse(message)
    const sensorEvents = btSensorDecode(messageJson.data)
    return Bacon.fromArray(sensorEvents.map(e => Object.assign(e, {rssi: messageJson.rssi})))
  } catch(e) {
    console.error(`Got invalid MQTT message: ${message}`, e)
    return Bacon.fromArray([])
  }
}


Bacon.EventStream.prototype.slidingTimeWindow = function(windowDuration) {
  let addToWindow, now, withTimeStamp
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
