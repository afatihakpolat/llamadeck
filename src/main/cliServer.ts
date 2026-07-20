import { createHash, randomUUID } from 'crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { createServer, type Server, type Socket } from 'net'
import { dirname, join, resolve } from 'path'
import {
  CLI_MAX_REQUEST_BYTES,
  CLI_PROTOCOL_VERSION,
  CliRequestSchema,
  type CliEndpointDescriptor,
  type CliRequest,
  type CliResponse
} from './cliProtocol'

const ENDPOINT_FILE_NAME = 'cli-endpoint.json'
const SOCKET_TIMEOUT_MS = 10_000

export interface CliServerHandle {
  endpointFile: string
  close: () => Promise<void>
}

interface CliServerOptions {
  userDataDir: string
  handleRequest: (request: CliRequest) => Promise<CliResponse>
}

function writeResponse(socket: Socket, response: CliResponse): void {
  socket.end(`${JSON.stringify(response)}\n`)
}

function writeEndpointFile(endpointFile: string, descriptor: CliEndpointDescriptor): void {
  mkdirSync(dirname(endpointFile), { recursive: true })
  const temporaryFile = `${endpointFile}.tmp`
  writeFileSync(temporaryFile, JSON.stringify(descriptor, null, 2), { encoding: 'utf-8', mode: 0o600 })
  renameSync(temporaryFile, endpointFile)
}

function removeOwnedEndpointFile(endpointFile: string, token: string): void {
  try {
    if (!existsSync(endpointFile)) return
    const parsed = JSON.parse(readFileSync(endpointFile, 'utf-8')) as Record<string, unknown>
    if (parsed.token === token) unlinkSync(endpointFile)
  } catch {
    // A stale descriptor is harmless and will be overwritten on the next launch.
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose) => {
    server.close(() => resolveClose())
  })
}

export async function startCliServer(options: CliServerOptions): Promise<CliServerHandle> {
  const userDataKey = createHash('sha256').update(resolve(options.userDataDir).toLowerCase()).digest('hex').slice(0, 16)
  const pipeId = `llamadeck-cli-${userDataKey}`
  const pipeName = `\\\\.\\pipe\\${pipeId}`
  const token = randomUUID()
  const endpointFile = join(options.userDataDir, ENDPOINT_FILE_NAME)

  const server = createServer((socket) => {
    let requestText = ''
    let handled = false

    socket.setEncoding('utf-8')
    socket.setTimeout(SOCKET_TIMEOUT_MS, () => {
      if (handled) return
      handled = true
      writeResponse(socket, { ok: false, error: 'CLI request timed out.', exitCode: 1 })
    })

    socket.on('data', (chunk: string) => {
      if (handled) return
      requestText += chunk

      if (Buffer.byteLength(requestText, 'utf-8') > CLI_MAX_REQUEST_BYTES) {
        handled = true
        writeResponse(socket, { ok: false, error: 'CLI request is too large.', exitCode: 1 })
        return
      }

      const newlineIndex = requestText.indexOf('\n')
      if (newlineIndex < 0) return
      handled = true

      let parsedJson: unknown
      try {
        parsedJson = JSON.parse(requestText.slice(0, newlineIndex))
      } catch {
        writeResponse(socket, { ok: false, error: 'CLI request is not valid JSON.', exitCode: 1 })
        return
      }

      const parsedRequest = CliRequestSchema.safeParse(parsedJson)
      if (!parsedRequest.success) {
        writeResponse(socket, { ok: false, error: 'CLI request has an invalid shape.', exitCode: 1 })
        return
      }
      if (parsedRequest.data.token !== token) {
        writeResponse(socket, { ok: false, error: 'CLI authentication failed.', exitCode: 1 })
        return
      }

      void options.handleRequest(parsedRequest.data)
        .then((response) => writeResponse(socket, response))
        .catch((error: unknown) => {
          writeResponse(socket, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            exitCode: 1
          })
        })
    })

    socket.on('error', () => {
      // Client disconnects do not affect the app or subsequent CLI requests.
    })
  })

  await new Promise<void>((resolveListen, rejectListen) => {
    const handleError = (error: Error) => rejectListen(error)
    server.once('error', handleError)
    server.listen(pipeName, () => {
      server.off('error', handleError)
      resolveListen()
    })
  })

  try {
    writeEndpointFile(endpointFile, {
      protocol: CLI_PROTOCOL_VERSION,
      pipeId,
      token,
      pid: process.pid
    })
  } catch (error) {
    await closeServer(server)
    throw error
  }

  let closed = false
  return {
    endpointFile,
    close: async () => {
      if (closed) return
      closed = true
      removeOwnedEndpointFile(endpointFile, token)
      await closeServer(server)
    }
  }
}
