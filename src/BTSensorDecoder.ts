import { SensorEvents, SensorEvents as Events } from '@chacal/js-utils/built/ISensorEvent'
import ISensorEvent = SensorEvents.ISensorEvent
import IPirEvent = SensorEvents.IPirEvent
import { buf as crc32 } from 'crc-32'

const MANUFACTURER_ID = 0xDADA
const ENVIRONMENT_SENSOR_TAG = 'm'.charCodeAt(0)
const PIR_SENSOR_TAG = 'k'.charCodeAt(0)
const CURRENT_SENSOR_TAG = 'n'.charCodeAt(0)
const TEMPERATURE_SENSOR_TAG = 't'.charCodeAt(0)
const TANK_LEVEL_SENSOR_TAG = 'w'.charCodeAt(0)
const AUTOPILOT_REMOTE_TAG = 'a'.charCodeAt(0)
const VOLTAGE_SENSOR_TAG = 'v'.charCodeAt(0)

export default function decodeBtSensorData(hexData: string): Array<ISensorEvent> {
  const data = Buffer.from(hexData, 'hex')
  return decodeData(data)
}

function decodeData(buf: Buffer): Array<ISensorEvent> {
  if (buf.length < 22) {
    console.error(`Got too short packet: ${buf.length}B Excepted at least 22 bytes.`)
    return []
  }

  const manufID = buf.readUInt16LE(11)
  if (manufID !== MANUFACTURER_ID) {
    console.error(`Unexpected manufacturer ID: ${manufID}`)
    return []
  }

  const sensorTag = buf.readUInt16LE(14)
  switch (sensorTag) {
    case ENVIRONMENT_SENSOR_TAG:
      return parseEnvironmentEvent(buf)
    case PIR_SENSOR_TAG:
      return parsePirEvent(buf)
    case CURRENT_SENSOR_TAG:
      return parseCurrentEvent(buf)
    case TEMPERATURE_SENSOR_TAG:
      return parseTemperatureEvent(buf)
    case TANK_LEVEL_SENSOR_TAG:
      return parseTankLevelEvent(buf)
    case AUTOPILOT_REMOTE_TAG:
      return parseAutopilotRemoteEvent(buf)
    case VOLTAGE_SENSOR_TAG:
      return parseVoltageEvent(buf)
    default:
      console.error(`Unexpected sensor tag: ${sensorTag}`)
      return []
  }
}

function parseEnvironmentEvent(buf: Buffer): Array<Events.IEnvironmentEvent> {
  assertLength(buf, 'environment sensor', 34)
  assertCrc(buf)

  const temperature = buf.readInt16LE(20) / 100
  const humidity = buf.readUInt16LE(22) / 100
  const pressure = buf.readUInt16LE(24) / 10
  const vcc = buf.readUInt16LE(26)
  const instance = buf.toString('utf-8', 30, 34)
  const ts = new Date().toISOString()

  return [{ tag: 'm', instance, temperature, humidity, pressure, vcc, ts }]
}

function parsePirEvent(buf: Buffer): Array<IPirEvent> {
  assertLength(buf, 'PIR sensor', 33)
  assertCrc(buf)

  const motionDetected = buf.readUInt8(20) !== 0
  const vcc = buf.readUInt16LE(21)
  const messageId = buf.readUInt32LE(23)
  const instance = buf.toString('utf-8', 29, 33)
  const ts = new Date().toISOString()
  return [{ tag: 'k', instance, motionDetected, vcc, messageId, ts }]
}

function parseCurrentEvent(buf: Buffer): Array<SensorEvents.ICurrentEvent> {
  assertLength(buf, 'Current sensor', 36)
  assertCrc(buf)

  const current = buf.readFloatLE(22)
  const vcc = buf.readUInt16LE(26)
  const messageCounter = buf.readUInt16LE(28)
  const instance = buf.toString('utf-8', 32, 36)
  const ts = new Date().toISOString()
  return [{ tag: 'c', instance, current, vcc, ts, messageCounter }]
}

function parseTemperatureEvent(buf: Buffer): Array<SensorEvents.ITemperatureEvent> {
  assertLength(buf, 'Temperature sensor', 30)
  assertCrc(buf)

  const temperature = buf.readInt16LE(20) / 100
  const vcc = buf.readUInt16LE(22)
  const instance = buf.toString('utf-8', 26, 30)
  const ts = new Date().toISOString()
  return [{ tag: 't', instance, temperature, vcc, ts }]
}

function parseTankLevelEvent(buf: Buffer): Array<SensorEvents.ITankLevel> {
  assertLength(buf, 'Tank level sensor', 29)
  assertCrc(buf)

  const tankLevel = buf.readUInt8(20)
  const vcc = buf.readUInt16LE(21)
  const instance = buf.toString('utf-8', 25, 29)
  const ts = new Date().toISOString()
  return [{ tag: 'w', instance, tankLevel, vcc, ts }]
}

function parseAutopilotRemoteEvent(buf: Buffer): Array<SensorEvents.IAutopilotCommand> {
  assertLength(buf, 'Autopilot remote', 32)
  assertCrc(buf)

  const buttonId = buf.readUInt8(20)
  const isLongPress = buf.readUInt8(21) > 0
  const messageCounter = buf.readUInt16LE(22)
  const vcc = buf.readUInt16LE(24)
  const instance = buf.toString('utf-8', 28, 32)
  const ts = new Date().toISOString()
  return [{ tag: 'a', instance, buttonId, isLongPress, vcc, ts, messageCounter }]
}

function parseVoltageEvent(buf: Buffer): Array<SensorEvents.IVoltageEvent> {
  assertLength(buf, 'Voltage sensor', 28)
  assertCrc(buf)

  const vcc = buf.readUInt16LE(20)
  const instance = buf.toString('utf-8', 24, 28)
  const ts = new Date().toISOString()
  return [{ tag: 'v', instance, vcc, ts }]
}

function assertLength(buf: Buffer, sensorType: string, expectedBytes: number) {
  if (buf.length !== expectedBytes) {
    const err = `Invalid ${sensorType} packet length: ${buf.length} Expected ${expectedBytes} bytes.`
    console.error(err)
    throw new Error(err)
  }
}

function assertCrc(buf: Buffer) {
  const crcFromMessage = buf.readUInt32LE(16)
  buf.writeUInt32LE(0, 16)  // Zero CRC in the message as it is part of the CRC calculation
  const calculatedCrc = crc32(buf.slice(6)) >>> 0   // Ignore first 6 bytes (MAC), convert to uint32_t
  if (crcFromMessage !== calculatedCrc) {
    console.error(`Invalid CRC`)
    throw new Error(`Invalid CRC`)
  }
}
