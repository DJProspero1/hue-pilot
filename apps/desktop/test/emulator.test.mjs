import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findNodeBounds, findTileBounds, findTileCentre, findVideoBox, parseEmulatorSerial, screenSize, visibleTapPoint } from '../src/main/hue-emulator.ts';

// Trimmed uiautomator dumps recorded from the Philips Hue app (6.1.0) in the emulator.
const HOME = `<hierarchy rotation="0"><node bounds="[0,0][1080,2400]" content-desc="">
<node content-desc="Disarmed&#10;Ready to arm" class="android.view.View" bounds="[32,532][1049,721]" />
<node content-desc="0.00%, Brightness slider&#10;Living room" bounds="[32,2315][1049,2400]" />
<node content-desc="Living room" bounds="[828,2336][1049,2400]" />
<node content-desc="HOME" bounds="[0,2190][216,2337]" /><node content-desc="SYNC" bounds="[432,2190][648,2337]" /></node></hierarchy>`;

const SECURITY = `<hierarchy rotation="0"><node bounds="[0,0][1080,2400]" content-desc="">
<node content-desc="Disarmed" bounds="[32,315][1049,399]" />
<node content-desc="Camera&#10; Fair&#10;50 min ago" bounds="[32,1517][1049,2089]" />
<node content-desc="Living room&#10; 48%&#10; Excellent&#10;2:07 pm" bounds="[32,2120][1049,2400]" /></node></hierarchy>`;

const LIVE = `<hierarchy rotation="0"><node bounds="[0,0][1080,2400]" content-desc="">
<node content-desc="Camera" bounds="[0,168][1080,315]" /><node content-desc="Close" bounds="[42,199][168,325]" />
<node content-desc="Live view" bounds="[42,359][212,412]" /><node content-desc=" Fair" bounds="[42,412][148,459]" />
<node class="android.view.View" bounds="[0,903][1080,1654]" content-desc="" />
<node content-desc="TAKE ACTION" bounds="[186,2248][396,2287]" /></node></hierarchy>`;

test('camera tiles are matched only on the Security page, never the room with the same name', () => {
  assert.equal(findTileCentre(HOME, 'Living room'), null);
  assert.deepEqual(findTileCentre(SECURITY, 'Living room'), { x: 541, y: 2260 });
  assert.deepEqual(findTileCentre(SECURITY, 'Camera'), { x: 541, y: 1803 });
  assert.equal(findTileCentre(SECURITY, 'Garage'), null);
  assert.equal(findTileCentre(SECURITY, 'Cam'), null); // no prefix matching
});

test('navigation anchors: Home security tile has two lines, the Security header has one', () => {
  assert.deepEqual(findNodeBounds(HOME, /^(Disarmed|Armed)[^\n]*\n/), { x1: 32, y1: 532, x2: 1049, y2: 721 });
  assert.equal(findNodeBounds(SECURITY, /^(Disarmed|Armed)[^\n]*\n/), null);
  assert.deepEqual(findNodeBounds(HOME, /^HOME$/), { x1: 0, y1: 2190, x2: 216, y2: 2337 });
  assert.deepEqual(findNodeBounds(LIVE, /^Close$/), { x1: 42, y1: 199, x2: 168, y2: 325 });
  assert.ok(findNodeBounds(LIVE, /^(Live view|Connection Issue|Connecting)/));
});

test('the video box is the player container minus the side margins, at 16:9', () => {
  assert.deepEqual(findVideoBox(LIVE), { x: 32, y: 903, w: 1016, h: 572 });
  assert.equal(findVideoBox(HOME), null);
  assert.deepEqual(screenSize(LIVE), { w: 1080, h: 2400 });
  assert.deepEqual(screenSize(''), { w: 1080, h: 2400 });
});

test('the last camera tile is partly under the bottom nav: tap the visible strip, or ask to scroll', () => {
  const withNav = SECURITY.replace('</node></hierarchy>', '<node content-desc="HOME" bounds="[0,2190][216,2337]" /><node content-desc="SYNC" bounds="[432,2190][648,2337]" /></node></hierarchy>');
  const living = findTileBounds(withNav, 'Living room');
  assert.deepEqual(living, { x1: 32, y1: 2120, x2: 1049, y2: 2400 });
  // Geometric centre (541, 2260) would hit the SYNC tab; the visible strip is 2120..2182.
  assert.equal(visibleTapPoint(withNav, living), null);
  const floodlight = findTileBounds(withNav, 'Camera');
  assert.deepEqual(visibleTapPoint(withNav, floodlight), { x: 541, y: 1803 });
  // A tile that is mostly visible above the nav gets the centre of its visible part.
  const partly = { x1: 32, y1: 1900, x2: 1049, y2: 2400 };
  assert.deepEqual(visibleTapPoint(withNav, partly), { x: 541, y: 2041 });
  // No nav bar on screen: plain centre.
  assert.deepEqual(visibleTapPoint(SECURITY, living), { x: 541, y: 2260 });
});

test('adb devices parsing picks a booted emulator only', () => {
  assert.equal(parseEmulatorSerial('List of devices attached\nemulator-5554\tdevice\n'), 'emulator-5554');
  assert.equal(parseEmulatorSerial('List of devices attached\nemulator-5554\toffline\n'), null);
  assert.equal(parseEmulatorSerial('List of devices attached\nR58M12345\tdevice\n'), null);
  assert.equal(parseEmulatorSerial(''), null);
});
