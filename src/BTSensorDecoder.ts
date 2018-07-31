import {SensorEvents, SensorEvents as Events} from "@chacal/js-utils"
import ISensorEvent = SensorEvents.ISensorEvent
import IPirEvent = SensorEvents.IPirEvent

const MANUFACTURER_ID = 0xDADA
const ENVIRONMENT_SENSOR_TAG = 'm'.charCodeAt(0)
const PIR_SENSOR_TAG = 'k'.charCodeAt(0)

export default function decodeBtSensorData(hexData: string): Array<ISensorEvent> {
  const data = Buffer.from(hexData, 'hex')
  return decodeData(data)
}

function decodeData(buf: Buffer): Array<ISensorEvent> {
  if(buf.length < 22) {
    console.error(`Got too short packet: ${buf.length}B Excepted at least 22 bytes.`)
    return []
  }

  const manufID = buf.readUInt16LE(11)
  if(manufID !== MANUFACTURER_ID) {
    console.error(`Unexpected manufacturer ID: ${manufID}`)
    return []
  }

  const sensorTag = buf.readUInt16LE(14)
  switch (sensorTag) {
    case ENVIRONMENT_SENSOR_TAG:
      return parseEnvironmentEvents(buf)
    case PIR_SENSOR_TAG:
      return parsePirEvent(buf)
    default:
      console.error(`Unexpected sensor tag: ${sensorTag}`)
      return []
  }
}

function parseEnvironmentEvents(buf: Buffer): Array<ISensorEvent> {
  assertLength(buf, 'environment sensor', 30)

  const temperature = buf.readInt16LE(16) / 100
  const humidity = buf.readUInt16LE(18) / 100
  const pressure = buf.readUInt16LE(20) / 10
  const vcc = buf.readUInt16LE(22)
  const instance = buf.toString('utf-8', 26, 30)
  const ts = new Date().toISOString()

  const tempEvent: Events.ITemperatureEvent = {tag: 't', instance, temperature, vcc, ts}
  const humEvent: Events.IHumidityEvent = {tag: 'h', instance, humidity, vcc, ts}
  const pressEvent: Events.IPressureEvent = {tag: 'p', instance, pressure, vcc, ts}

  return [tempEvent, humEvent, pressEvent]
}

function parsePirEvent(buf: Buffer): Array<IPirEvent> {
  assertLength(buf, 'PIR sensor', 25)

  const motionDetected = buf.readUInt8(16) !== 0
  const vcc = buf.readUInt16LE(17)
  const instance = buf.toString('utf-8', 21, 25)
  const ts = new Date().toISOString()
  const pirEvent = {tag: 'k', instance, motionDetected, vcc, ts}
  return [pirEvent]
}

function assertLength(buf: Buffer, sensorType: string, expectedBytes: number) {
  if(buf.length !== expectedBytes) {
    const err = `Invalid ${sensorType} packet length: ${buf.length} Expected ${expectedBytes} bytes.`
    console.error(err)
    throw new Error(err)
  }
}
