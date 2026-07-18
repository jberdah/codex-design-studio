declare module "pngjs" {
  export interface DecodedPng {
    width: number;
    height: number;
    data: Uint8Array;
  }

  export const PNG: {
    sync: {
      read(data: Buffer, options?: { skipRescale?: boolean }): DecodedPng;
      write(data: DecodedPng): Buffer;
    };
  };
}
