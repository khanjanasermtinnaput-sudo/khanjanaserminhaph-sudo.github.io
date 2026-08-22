import assert from 'node:assert/strict';
import { test } from 'node:test';
import rosterParse from '../js/admin/roster-parse.js';
import rosterMatch from '../js/admin/roster-match.js';

const { parseRosterText } = rosterParse;
const { matchPlayer, similarity } = rosterMatch;

test('clean input: singles event with nickname + class', () => {
  const { events, warnings } = parseRosterText(`ชายเดี่ยว
ปฐวี ทับทิมแดง โน๊ต 4/9
ชานุกูล ศรีทองกุล กาฟิวส์ 4/7`);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'ms');
  assert.equal(events[0].players.length, 2);
  assert.deepEqual(events[0].players[0], {
    raw: 'ปฐวี ทับทิมแดง โน๊ต 4/9', eventLabel: null,
    firstName: 'ปฐวี', lastName: 'ทับทิมแดง', nickname: 'โน๊ต',
    fullName: 'ปฐวี ทับทิมแดง', classLabel: '4/9', warnings: [],
  });
  assert.equal(events[0].players[1].nickname, 'กาฟิวส์');
  assert.equal(warnings.length, 0);
});

test('messy input: event label glued to a player line, before or after, with honorific', () => {
  const { events, warnings } = parseRosterText(`ชายเดี่ยว นาย ปฐวี ทับทิมแดง โน๊ต 4/9
นาย ชานุกูล ศรีทองกุล กาฟิวส์ 4/7 ชายเดี่ยว`);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'ms');
  assert.equal(events[0].players.length, 2);
  assert.equal(events[0].players[0].firstName, 'ปฐวี');
  assert.equal(events[0].players[0].classLabel, '4/9');
  assert.equal(events[0].players[1].firstName, 'ชานุกูล');
  assert.equal(events[0].players[1].classLabel, '4/7');
  assert.equal(warnings.length, 0);
});

test('doubles: pairs of consecutive lines, nickname optional, leading seed number stripped', () => {
  const { events } = parseRosterText(`ชายคู่
1 วัชรพล เหล็กกล้า 5/6
พุฒินันท์ วงศ์อินทร์ 5/6

2 ทินภัทร กาญจนเสริม พัตเตอร์ 6/4
จิรโรจน์ บุตรกิ่งดี โอม 6/4`);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'md');
  assert.equal(events[0].pairs.length, 2);
  assert.equal(events[0].pairs[0][0].firstName, 'วัชรพล');
  assert.equal(events[0].pairs[0][0].nickname, null);
  assert.equal(events[0].pairs[0][1].firstName, 'พุฒินันท์');
  assert.equal(events[0].pairs[1][0].nickname, 'พัตเตอร์');
  assert.equal(events[0].pairs[1][1].nickname, 'โอม');
});

test('doubles with class prefixed ม.: ม.4/9 normalizes to 4/9', () => {
  const { events } = parseRosterText(`ชายคู่

สิรภัทร ขยันสลุง เบ็น ม.4/9
ธนโชติ ดินแดง เชน ม.4/9`);
  assert.equal(events[0].pairs.length, 1);
  assert.equal(events[0].pairs[0][0].classLabel, '4/9');
  assert.equal(events[0].pairs[0][1].classLabel, '4/9');
});

test('multiple events in one paste, each with their own player list', () => {
  const { events } = parseRosterText(`ชายเดี่ยว
1 ปฐวี ทับทิมแดง โน๊ต 4/9
2 ชานุกูล ศรีทองกุล กาฟิวส์ 4/7

ชายคู่
1 วัชรพล เหล็กกล้า 5/6
พุฒินันท์ วงศ์อินทร์ 5/6

2 ทินภัทร กาญจนเสริม พัตเตอร์ 6/4
จิรโรจน์ บุตรกิ่งดี โอม 6/4`);
  assert.equal(events.length, 2);
  assert.equal(events[0].kind, 'ms');
  assert.equal(events[0].players.length, 2);
  assert.equal(events[1].kind, 'md');
  assert.equal(events[1].pairs.length, 2);
});

test('unpaired doubles player produces a warning, not a silent drop', () => {
  const { events, warnings } = parseRosterText(`ชายคู่
วัชรพล เหล็กกล้า 5/6`);
  assert.equal(events[0].pairs.length, 1);
  assert.equal(events[0].pairs[0][1], null);
  assert.ok(warnings.some(w => w.code === 'unpaired_player'));
});

test('missing class produces a warning', () => {
  const { warnings } = parseRosterText(`ชายเดี่ยว
ปฐวี ทับทิมแดง โน๊ต`);
  assert.ok(warnings.some(w => w.code === 'missing_class'));
});

test('a line before any event header produces a no_event_context warning, not a crash', () => {
  const { events, warnings } = parseRosterText(`ปฐวี ทับทิมแดง โน๊ต 4/9`);
  assert.equal(events.length, 0);
  assert.ok(warnings.some(w => w.code === 'no_event_context'));
});

// ── fuzzy matching ──

test('matchPlayer: exact name match', () => {
  const players = [{ id: 1, name: 'ปฐวี ทับทิมแดง', nickname: 'โน๊ต', classLabel: '4/9' }];
  const r = matchPlayer({ fullName: 'ปฐวี ทับทิมแดง', nickname: 'โน๊ต', classLabel: '4/9' }, players);
  assert.equal(r.tier, 'exact');
  assert.equal(r.candidates[0].player.id, 1);
});

test('matchPlayer: no match at all', () => {
  const players = [{ id: 1, name: 'สมชาย ใจดี', nickname: 'ชาย', classLabel: '1/1' }];
  const r = matchPlayer({ fullName: 'วิภาวดี รักเรียน', nickname: 'วิว', classLabel: '2/2' }, players);
  assert.equal(r.tier, 'none');
});

test('matchPlayer: nickname+class strong signal despite legal-name spelling drift', () => {
  const players = [{ id: 1, name: 'ปฐวี ทับทิมแดง', nickname: 'โน้ต', classLabel: '4/9' }];
  const r = matchPlayer({ fullName: 'ปฐวี ทับทิมแดง', nickname: 'โน๊ต', classLabel: '4/9' }, players);
  assert.equal(r.tier, 'exact');
});

test('similarity: identical strings score 1, unrelated strings score low', () => {
  assert.equal(similarity('โน๊ต', 'โน๊ต'), 1);
  assert.ok(similarity('โน๊ต', 'อชิ') < 0.5);
});
