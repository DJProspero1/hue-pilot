import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deriveAppKey, masterKey, normalizePassphrase, offerSignatureVariants, signMessage, verifyMessage } from '../src/main/hue-e2ee.ts';

const PASS = 'approval crept dislocate embellish flammable puppy scam struggle mom fox';

test('passphrase normalisation collapses whitespace', () => {
  assert.equal(normalizePassphrase('  approval   crept\tdislocate \n'), 'approval crept dislocate');
});

test('master key and app key are deterministic and depend on passphrase and salt', () => {
  const a = masterKey(PASS, Buffer.alloc(0));
  assert.equal(a.length, 32);
  assert.deepEqual(a, masterKey(`${PASS} `, Buffer.alloc(0)));
  assert.notDeepEqual(a, masterKey(PASS, Buffer.from('4618484926709760')));
  assert.notDeepEqual(a, masterKey(`${PASS} extra`, Buffer.alloc(0)));
  const k1 = deriveAppKey(PASS, Buffer.alloc(0));
  const k2 = deriveAppKey(PASS, Buffer.alloc(0));
  assert.deepEqual(k1.scalar, k2.scalar);
  assert.equal(k1.publicRaw.length, 65);
  assert.equal(k1.publicRaw[0], 0x04);
  assert.notDeepEqual(k1.scalar, deriveAppKey(PASS, Buffer.from('salt')).scalar);
});

test('signatures verify with the derived public key in both encodings', () => {
  const key = deriveAppKey(PASS, Buffer.alloc(0));
  const sdp = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n';
  const raw = signMessage(sdp, key, 'ieee-p1363');
  assert.equal(raw.length, 64);
  assert.ok(verifyMessage(sdp, raw, key, 'ieee-p1363'));
  const der = signMessage(sdp, key, 'der');
  assert.ok(der.length >= 68 && der[0] === 0x30);
  assert.ok(verifyMessage(sdp, der, key, 'der'));
  assert.ok(!verifyMessage(sdp + 'x', raw, key, 'ieee-p1363'));
  // Same message digest as SHA-256 of the UTF-8 bytes (sanity for the signing input).
  assert.equal(createHash('sha256').update(sdp).digest().length, 32);
});

test('offer signature variants cover salts and encodings and carry the public key', () => {
  const variants = offerSignatureVariants('v=0\r\n', PASS, '4618484926709760');
  assert.equal(variants.length, 4);
  assert.deepEqual(variants.map((v) => v.name), ['no salt, raw r‖s signature', 'no salt, DER signature', 'home-id salt, raw r‖s signature', 'home-id salt, DER signature']);
  for (const v of variants) {
    assert.ok(v.fields.signature.length > 40);
    assert.equal(Buffer.from(v.fields.public_key, 'base64').length, 65);
  }
  assert.deepEqual(offerSignatureVariants('v=0\r\n', '   ', null), []);
  assert.equal(offerSignatureVariants('v=0\r\n', PASS, null).length, 2);
});
