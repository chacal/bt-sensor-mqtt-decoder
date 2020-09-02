import _ = require('lodash')
import btSensorDecode from './BTSensorDecoder'
import { SensorEvents } from '@chacal/js-utils/built/ISensorEvent'
import { Mqtt } from '@chacal/js-utils/built/Mqtt'
import { EventStream, fromArray, Property } from 'baconjs'


const MQTT_BROKER = process.env.MQTT_BROKER ? process.env.MQTT_BROKER : 'mqtt://mqtt-home.chacal.fi'
const MQTT_USERNAME = process.env.MQTT_USERNAME || undefined
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || undefined

const BUFFER_TIME_MS = 2000   // Coalesce events from each sensor this many ms and pass on only the one with the highest RSSI
const MESSAGE_COUNTER_WINDOW_SIZE = 10   // Remember this many latest message counters and publish new event only if its counter is not in the remembered list

const mqttClient = Mqtt.startMqttClient(MQTT_BROKER, MQTT_USERNAME, MQTT_PASSWORD)
mqttClient.subscribe('/bt-sensor-gw/+/value')
registerProcessSignalHandler()


const allSensorEvents = Mqtt.messageStreamFrom(mqttClient).flatMap(parseEventsFromBytes)
const pirEvents = allSensorEvents.filter(SensorEvents.isPirEvent) as EventStream<SensorEvents.IPirEvent>
const currentEvents = allSensorEvents.filter(SensorEvents.isCurrent) as EventStream<SensorEvents.ICurrentEvent>
const autopilotCommandEvents = allSensorEvents.filter(SensorEvents.isAutopilotCommand) as EventStream<SensorEvents.IAutopilotCommand>
const otherEvents: EventStream<SensorEvents.ISensorEvent> = allSensorEvents
  .filter(e => !SensorEvents.isPirEvent(e) && !SensorEvents.isCurrent(e) && !SensorEvents.isAutopilotCommand(e))

publishEventsWithMessageCounter(currentEvents)
publishEventsWithMessageCounter(autopilotCommandEvents)

function publishEventsWithMessageCounter(events: EventStream<SensorEvents.ICurrentEvent | SensorEvents.IAutopilotCommand>) {
  events
    .groupBy(event => event.instance)
    .flatMap(streamFromOneInstance => streamFromOneInstance)
    .slidingWindow(MESSAGE_COUNTER_WINDOW_SIZE, 1)
    .onValue(events => {
      const newestMessageCounter = _.last(events).messageCounter
      const messageCounterCounts = _.countBy(events, 'messageCounter')
      // Publish event only if its message counter value occurs once in the latest counter values list (= the message has not been seen yet)
      if (messageCounterCounts[`${newestMessageCounter}`] === 1) {
        publishEvent(_.last(events))
      }
    })
}

// Buffer PIR events for BUFFER_TIME_MS, but immediately publish a new event if its messageId has not been seen yet
// This allows immediate publishing of events with a new messageId, but still also publishes events with non-changed messageId
// if they occur at least BUFFER_TIME_MS apart.
pirEvents
  .groupBy(event => event.instance)
  .flatMap(streamFromOneInstance => slidingTimeWindow(streamFromOneInstance, BUFFER_TIME_MS))
  .onValue(latestEventsWithTs => {
    const latestEvent = _.last(latestEventsWithTs).value
    const eventsWithSameMessageId = latestEventsWithTs.filter(({ value, timestamp }) => value.messageId === latestEvent.messageId)
    if (eventsWithSameMessageId.length === 1) {
      publishEvent(latestEvent)
    }
  })


// Buffer others for BUFFER_TIME_MS and publish the one with the highest RSSI
otherEvents
  .groupBy(event => event.tag + event.instance)
  .flatMap(groupedStream => {
    // Buffer events for each sensor for BUFFER_TIME_MS and select the one with the highest RSSI
    // This is done in order to avoid multiple events being generated even if the same radio packet is received by multiple
    // ESP-BT-MQTT gateways
    return slidingTimeWindow(groupedStream, BUFFER_TIME_MS)
      .debounce(BUFFER_TIME_MS)
      .map(latestEventsWithTs => latestEventsWithTs.map(e => e.value))
      .map(latestEvents => _.last(_.sortBy(latestEvents, 'rssi')))
  })
  .onValue(publishEvent)


function publishEvent(e: SensorEvents.ISensorEvent): void {
  mqttClient.publish(`/sensor/${e.instance}/${e.tag}/state`, JSON.stringify(e), { retain: true, qos: 1 })
}


function parseEventsFromBytes(message): EventStream<SensorEvents.ISensorEvent> {
  try {
    const messageJson = JSON.parse(message)
    const sensorEvents = btSensorDecode(messageJson.data)
    return fromArray(sensorEvents.map(e => Object.assign(e, { rssi: messageJson.rssi })))
  } catch (e) {
    console.error(`Got invalid MQTT message: ${message}`, e)
    return fromArray([])
  }
}

function registerProcessSignalHandler() {
  process.on('SIGTERM', () => {
    console.log('SIGTERM signal received, closing MQTT connection..')
    mqttClient.end(false, () => {
      console.log('MQTT connection closed. Exiting..')
      process.exit(0)
    })
  })
}

interface Timestamped<T> {
  value: T
  timestamp: number
}

function slidingTimeWindow<T>(s: EventStream<T>, windowLengthMs: number): Property<Array<Timestamped<T>>> {

  function now() {
    return Date.now()
  }

  function withTimeStamp<T>(value: T): Timestamped<T> {
    return {
      value: value,
      timestamp: now()
    }
  }

  function addToWindow<T>(window: Array<Timestamped<T>>, value: Timestamped<T>) {
    window.push(value)
    let ref = window[0]
    while (ref != null && ref.timestamp < now() - windowLengthMs) {
      window = window.splice(1)
      ref = window[0]
    }
    return window
  }

  return s.map(withTimeStamp).scan([], addToWindow)
}
