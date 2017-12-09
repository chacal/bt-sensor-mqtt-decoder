import {SensorEvents, SensorEvents as Events} from "@chacal/js-utils"
import ISensorEvent = SensorEvents.ISensorEvent

const MANUFACTURER_ID = 0xDADA
const SENSOR_TAG = 'm'.charCodeAt(0)

export default function decodeBtSensorData(hexData: string): Array<ISensorEvent> {
  const data = Buffer.from(hexData, 'hex')
  return decodeData(data)
}

function decodeData(buf: Buffer): Array<ISensorEvent> {
  if(buf.length !== 30) {
    return []
  }

  const manufID = buf.readUInt16LE(11)
  if(manufID !== MANUFACTURER_ID) {
    console.error(`Unexpected manufacturer ID: ${manufID}`)
    return []
  }

  const sensorTag = buf.readUInt16LE(14)
  if(sensorTag !== SENSOR_TAG) {
    console.error(`Unexpected sensor tag: ${sensorTag}`)
  }

  const temperature = buf.readUInt16LE(16) / 100
  const humidity = buf.readUInt16LE(18) / 100
  const pressure = buf.readUInt16LE(20) / 10
  const vcc = buf.readUInt16LE(22)
  const instance = buf.toString('utf-8', 26, 30)
  const ts = new Date().toISOString()

  const tempEvent: Events.ITemperatureEvent = {tag: 't', instance, temperature, vcc, ts}
  const humEvent: Events.IHumidityEvent = {tag: 'h', instance, humidity, vcc, ts}
  const pressEvent: Events.IPressureEvent= {tag: 'p', instance, pressure, vcc, ts}

  return [tempEvent, humEvent, pressEvent]
}
