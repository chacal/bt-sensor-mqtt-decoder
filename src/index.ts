import mqtt = require('mqtt')
import Client = mqtt.Client
import btSensorDecode from './BTSensorDecoder'

const MQTT_BROKER = process.env.MQTT_BROKER ? process.env.MQTT_BROKER : 'mqtt://mqtt-home.chacal.fi'
const MQTT_USERNAME = process.env.MQTT_USERNAME || undefined
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || undefined


const mqttClient = startMqttClient(MQTT_BROKER, MQTT_USERNAME, MQTT_PASSWORD)
mqttClient.subscribe('/bt-sensor-gw/+/value')
mqttClient.on('message', onBtSensorEvent)


function onBtSensorEvent(topic: string, message: string) {
  try {
    const messageJson = JSON.parse(message)
    const sensorEvents = btSensorDecode(messageJson.data)
    sensorEvents
      .map(e => Object.assign(e, {rssi: messageJson.rssi}))
      .forEach(e => mqttClient.publish(`/sensor/${e.instance}/${e.tag}/state`, JSON.stringify(e), { retain: true, qos: 1 }))
  } catch (e) {
    console.error(`Got invalid MQTT message: ${message}`)
  }
}

function startMqttClient<A>(brokerUrl: string, username: string, password: string): Client {
  const client = mqtt.connect(brokerUrl, { username, password })
  client.on('connect', () => console.log('Connected to MQTT server'))
  client.on('offline', () => console.log('Disconnected from MQTT server'))
  client.on('error', (e) => console.log('MQTT client error', e))

  return client
}
