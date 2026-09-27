import { createECDH, createPrivateKey, createPublicKey, hkdfSync, pbkdf2Sync, sign as cryptoSign, verify as cryptoVerify, type KeyObject } from 'node:crypto';

/**
 * Hue Secure end-to-end-encryption key derivation, following Signify's E2EE whitepaper (2023):
 * passphrase (10 words) → PBKDF2 → master key → HKDF → app private key (P-256). The app key signs
 * the WebRTC SDP offer when "live view protection" is on, and decrypts key envelopes of clips.
 *
 * The whitepaper gives the algorithms but not the parameters (PBKDF2 salt/iterations, HKDF info)
 * nor how the signature travels in the signaling message. Values below follow a community
 * reverse-engineering effort (PBKDF2-SHA256, 100 000 iterations, HKDF info "app_key"); several
 * salt and encoding variants are produced so the caller can try them in turn.
 */

const b64url = (b: Buffer) => b.toString('base64url');
const P256_ORDER = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');

/** Normalises a typed passphrase: trims, collapses whitespace (the words are joined by single spaces). */
export function normalizePassphrase(p: string): string {
  return p.trim().split(/\s+/).join(' ');
}

export function masterKey(passphrase: string, salt: Buffer, iterations = 100_000): Buffer {
  return pbkdf2Sync(normalizePassphrase(passphrase), salt, iterations, 32, 'sha256');
}

export interface AppKey {
  privateKey: KeyObject;
  publicKey: KeyObject;
  /** Uncompressed SEC1 point (65 bytes). */
  publicRaw: Buffer;
  scalar: Buffer;
}

/** Derives the shared app key pair (A_priv / A_pub) of the home from the passphrase. */
export function deriveAppKey(passphrase: string, salt: Buffer, info = 'app_key'): AppKey {
  const master = masterKey(passphrase, salt);
  let scalar = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), info, 32));
  // HKDF output must be a valid scalar (1 ≤ d < n); re-derive in the astronomically rare other case.
  for (let i = 1; (BigInt(`0x${scalar.toString('hex')}`) >= P256_ORDER || scalar.every((b) => b === 0)) && i < 8; i++) {
    scalar = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), `${info}\u0000${i}`, 32));
  }
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(scalar);
  const publicRaw = ecdh.getPublicKey();
  const x = b64url(publicRaw.subarray(1, 33));
  const y = b64url(publicRaw.subarray(33, 65));
  const privateKey = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: b64url(scalar), x, y }, format: 'jwk' });
  const publicKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x, y }, format: 'jwk' });
  return { privateKey, publicKey, publicRaw, scalar };
}

export type SignatureEncoding = 'ieee-p1363' | 'der';

export function signMessage(message: string | Buffer, key: AppKey, encoding: SignatureEncoding): Buffer {
  return cryptoSign('sha256', typeof message === 'string' ? Buffer.from(message, 'utf8') : message, { key: key.privateKey, dsaEncoding: encoding });
}

export function verifyMessage(message: string | Buffer, signature: Buffer, key: AppKey, encoding: SignatureEncoding): boolean {
  return cryptoVerify('sha256', typeof message === 'string' ? Buffer.from(message, 'utf8') : message, { key: key.publicKey, dsaEncoding: encoding }, signature);
}

export interface OfferSignatureVariant {
  name: string;
  /** Extra fields merged into the SDP_OFFER signaling payload next to `type` and `sdp`. */
  fields: Record<string, string>;
}

/**
 * Candidate ways of attaching an app-key signature to an SDP offer. The camera silently ignores
 * offers it cannot verify, so the viewer tries these one after another.
 */
export function offerSignatureVariants(sdp: string, passphrase: string, homeId: string | null): OfferSignatureVariant[] {
  const pass = normalizePassphrase(passphrase);
  if (!pass) return [];
  const salts: [string, Buffer][] = [['no salt', Buffer.alloc(0)]];
  if (homeId) salts.push(['home-id salt', Buffer.from(homeId, 'utf8')]);
  const out: OfferSignatureVariant[] = [];
  for (const [saltName, salt] of salts) {
    const key = deriveAppKey(pass, salt);
    for (const encoding of ['ieee-p1363', 'der'] as SignatureEncoding[]) {
      const signature = signMessage(sdp, key, encoding).toString('base64');
      out.push({ name: `${saltName}, ${encoding === 'der' ? 'DER' : 'raw r‖s'} signature`, fields: { signature, public_key: key.publicRaw.toString('base64') } });
    }
  }
  return out;
}
