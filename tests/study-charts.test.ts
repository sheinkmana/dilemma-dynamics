import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AverageDraftingChart,
  OpponentEffectsChart,
  SelfPlayCooperationChart,
} from '../src/web/StudyCharts.js';

test('primary chart exposes both temperatures and intervals without relying on colour', () => {
  const html = renderToStaticMarkup(createElement(AverageDraftingChart));
  assert.match(html, /aria-describedby=/);
  assert.match(html, /98\.75%/);
  for (const estimate of ['-0.1088', '-0.0896', '-0.1680', '-0.2246'])
    assert(html.includes(estimate));
  assert(html.includes('-0.1640, -0.0577'));
  assert(html.includes('Temperature 0') && html.includes('Temperature 1'));
});

test('opponent chart preserves the reversal and names the exploratory comparison', () => {
  const html = renderToStaticMarkup(createElement(OpponentEffectsChart));
  assert.match(html, /Exploratory/);
  for (const label of ['Always cooperate', 'Always defect', 'Grim trigger', 'Tit-for-Tat'])
    assert(html.includes(label));
  assert.match(html, /positive favours Direct/);
  assert.equal((html.match(/Reversal/g) ?? []).length, 2);
});

test('self-play chart reports equal-episode weighting rather than pooling rounds', () => {
  const html = renderToStaticMarkup(createElement(SelfPlayCooperationChart));
  assert.match(html, /each episode has equal weight/);
  // Super Direct at zero: episode-weighted 26.8%, whereas pooled rounds give 33.0%.
  for (const value of ['26.8%', '0.7%', '24.6%', '5.1%']) assert(html.includes(value));
  assert(!html.includes('33.0%'));
  assert(!/NaN|Infinity/.test(html));
});
