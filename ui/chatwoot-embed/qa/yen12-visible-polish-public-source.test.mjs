import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/client/cloud-private-chat.css', import.meta.url), 'utf8');
const nav = readFileSync(new URL('../src/client/cloud-contact-navigation.css', import.meta.url), 'utf8');
const section = css.split('YEN-12 | Visible polish on the ORIGINAL Chatwoot Guest')[1];
assert.ok(section, 'new UI must stay in the reviewed native Cloud CSS');

test('YEN-12 gives contact rows a visible hover and selected treatment', () => {
  assert.match(section, /\.conversations-list \.conversation:hover/);
  assert.match(section, /\.conversations-list \.conversation:is\(/);
  assert.match(section, /min-height:66px/);
  assert.match(section, /border-radius:12px/);
});

test('YEN-12 visually polishes native bubbles without rewriting content', () => {
  assert.match(section, /\.message-bubble-container \.prose-bubble/);
  assert.match(section, /line-height:1\.48/);
  assert.match(section, /\.message-bubble-container time/);
  assert.match(section, /font-variant-numeric:tabular-nums/);
  assert.doesNotMatch(section, /content\s*:\s*["']/);
});

test('YEN-12 retains native composer and read-only Cloud/Brain ownership', () => {
  assert.match(section, /\.reply-box:not\(\.is-private\)/);
  assert.match(section, /:focus-within/);
  assert.doesNotMatch(section, /(?:pointer-events\s*:\s*none|visibility\s*:\s*hidden|display\s*:\s*none)/);
  assert.doesNotMatch(section, /(?:position\s*:\s*fixed|z-index\s*:)/);
});

test('YEN-12 keeps the one original Cloud collapse button and mobile layout', () => {
  assert.match(nav, /button:has\(>span\.i-lucide-arrow-right-to-line\)/);
  assert.match(nav, /button:has\(>span\.i-lucide-arrow-left-to-line\)/);
  assert.match(nav, /@media \(max-width:767px\)/);
  assert.doesNotMatch(section, /\.conversations-list-wrap\.hidden/);
  assert.doesNotMatch(section, /(?:width|min-width|max-width)\s*:\s*256px/);
});

test('YEN-12 respects theme and reduced-motion settings', () => {
  assert.match(section, /var\(--green-9, var\(--blue-9\)\)/);
  assert.match(section, /var\(--slate-1\)/);
  assert.match(section, /prefers-reduced-motion:reduce/);
  assert.match(section, /focus-visible/);
});

test('YEN-12 source has no personal, credential or real-message literals', () => {
  assert.doesNotMatch(section, /(?:sk-[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{12,}|Bearer\s+[A-Za-z0-9._-]{16,})/);
  assert.doesNotMatch(section, /(?:C:\\Users\\|@gmail\.com|\+[1-9]\d{8,14})/i);
});
