import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const nav = readFileSync(new URL('../src/client/cloud-contact-navigation.css', import.meta.url), 'utf8');
const privateChat = readFileSync(new URL('../src/client/cloud-private-chat.css', import.meta.url), 'utf8');

test('uses one existing Chatwoot arrow control, without a second YENRA toggle', () => {
  assert.match(nav, /button:has\(>span\.i-lucide-arrow-right-to-line\)/);
  assert.match(nav, /button:has\(>span\.i-lucide-arrow-left-to-line\)/);
  assert.match(nav, /\.yenra-cloud-show-contacts,\s*\n\.yenra-cloud-hide-contacts\s*\{\s*display:\s*none\s*!important/);
  assert.doesNotMatch(privateChat, /\.conversations-list-wrap>div:first-child>div:last-child>button\s*\{\s*display:\s*none/);
});

test('respects Chatwoot native hidden state and lets the chat area expand', () => {
  assert.match(nav, /\.conversations-list-wrap\.hidden\s*\{[^}]*flex:\s*0\s+0\s+0px\s*!important;[^}]*width:\s*0\s*!important/s);
  assert.match(nav, /\.conversations-list-wrap\.hidden>div:first-child\s*\{[^}]*position:\s*absolute\s*!important/s);
  assert.match(nav, /\.conversation-details-wrap>div:first-child\s*\{\s*padding-inline-start:\s*44px\s*!important/);
});

test('keeps Cloud search/filter/sort space and mobile controls', () => {
  assert.match(privateChat, /width:calc\(256px - 116px\);height:22px/);
  assert.match(nav, /@media \(max-width:767px\)/);
  assert.match(nav, /min-height:44px!important/);
  assert.match(nav, /button:first-child:has\(>i\.i-lucide-chevron-left\)/);
});

test('no hardcoded credential, local profile, or private contact data in public CSS', () => {
  for (const content of [nav, privateChat]) {
    assert.doesNotMatch(content, /\b(?:gh[pousr]_[a-z0-9]{12,}|sk-[a-z0-9]{12,}|Bearer\s+[A-Za-z0-9._-]{16,})\b/i);
    assert.doesNotMatch(content, /C:\\Users\\|\b\d{6,10}\b|\+[1-9]\d{8,14}\b|@gmail\.com/i);
  }
});

// Include the separately scoped YEN-12 source-only visual safety checks in CI.
import './yen12-visible-polish-public-source.test.mjs';
