/** The subset of `qrcode` Sage uses: an SVG string for an address. The package ships no types. */
declare module "qrcode" {
  export function toString(text: string, options?: { type?: "svg" | "terminal" | "utf8"; margin?: number; width?: number; color?: { dark?: string; light?: string } }): Promise<string>;
  const QRCode: { toString: typeof toString };
  export default QRCode;
}
