// Stub type declarations for Node.js-only modules not installed in the browser workspace
// These modules (modbus-serial, node-opcua) are loaded at runtime via dynamic import()
// only when the adapter runs in a Node.js environment (Electron main process or station-PC-side bridge)

declare module 'modbus-serial' {
  export class ModbusRTU {
    connectTCP(host: string, options?: Record<string, unknown>): Promise<void>;
    close(cb?: () => void): void;
    setID(id: number): void;
    readHoldingRegisters(address: number, count: number): Promise<{ data: Uint16Array }>;
  }
}

declare module 'node-opcua' {
  export class OPCUAClient {
    static create(options?: Record<string, unknown>): OPCUAClient;
    connect(endpoint: string): Promise<void>;
    disconnect(): Promise<void>;
    getSession(options?: Record<string, unknown>): Promise<Session>;
  }
  export interface Session {
    read(nodeId: Record<string, unknown>): Promise<{ value: { value: unknown }; statusCode: { toString(): string } }>;
    close(): Promise<void>;
  }
}
