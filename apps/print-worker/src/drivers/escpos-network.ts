import { Socket } from 'node:net'

type EscPosNetworkConfig = {
  host: string
  port?: number
  timeout_ms?: number
  cut?: boolean
  open_drawer?: boolean
}

const ESC = 0x1b
const GS = 0x1d

function asConfig(value: Record<string, unknown>): EscPosNetworkConfig {
  const host = typeof value.host === 'string' ? value.host.trim() : ''
  const port = typeof value.port === 'number' ? value.port : 9100
  const timeoutMs = typeof value.timeout_ms === 'number' ? value.timeout_ms : 10_000

  if (!host) throw new Error('ESC/POS network printer requires connection_config.host')
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('ESC/POS network printer port must be between 1 and 65535')
  }

  return {
    host,
    port,
    timeout_ms: Math.max(1_000, timeoutMs),
    cut: value.cut !== false,
    open_drawer: value.open_drawer === true,
  }
}

function sanitiseText(text: string) {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[£]/g, '\x9c')
    .replace(/[^\x09\x0a\x0d\x20-\x7e\x80-\xff]/g, '?')
}

export function buildEscPosPayload(ticket: string, configValue: Record<string, unknown>) {
  const config = asConfig(configValue)
  const chunks: Buffer[] = [
    Buffer.from([ESC, 0x40]),
    Buffer.from([ESC, 0x74, 0x00]),
    Buffer.from(sanitiseText(ticket), 'latin1'),
    Buffer.from('\n\n', 'latin1'),
  ]

  if (config.open_drawer) chunks.push(Buffer.from([ESC, 0x70, 0x00, 0x19, 0xfa]))
  if (config.cut) chunks.push(Buffer.from([GS, 0x56, 0x00]))

  return Buffer.concat(chunks)
}

export async function printEscPosNetwork(
  ticket: string,
  configValue: Record<string, unknown>,
): Promise<void> {
  const config = asConfig(configValue)
  const payload = buildEscPosPayload(ticket, configValue)

  await new Promise<void>((resolve, reject) => {
    const socket = new Socket()
    let settled = false

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      socket.destroy()
      if (error) reject(error)
      else resolve()
    }

    socket.setTimeout(config.timeout_ms!)
    socket.once('timeout', () => finish(new Error(`Printer connection timed out after ${config.timeout_ms}ms`)))
    socket.once('error', (error) => finish(new Error(`Printer connection failed: ${error.message}`)))

    socket.connect(config.port!, config.host, () => {
      socket.write(payload, (error) => {
        if (error) {
          finish(new Error(`Unable to write to printer: ${error.message}`))
          return
        }

        socket.end(() => finish())
      })
    })
  })
}
