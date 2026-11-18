import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification
} from '@agentclientprotocol/sdk/unstable'

/** The subset of client operations used by the shared Pi runtime. */
export interface PiAcpClient {
  notify(method: 'session/update', notification: SessionNotification): Promise<void>
  request(method: 'session/request_permission', request: RequestPermissionRequest): Promise<RequestPermissionResponse>
}
