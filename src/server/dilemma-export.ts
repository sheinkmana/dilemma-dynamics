import type { DilemmaSession } from '../dilemma/types.js';
import { ACTIONS, CONTINUATION_PROBABILITY, payoff } from '../dilemma/spec.js';
import { decisionInformation, continuationObservation } from '../dilemma/education.js';
export function dilemmaHtml(session: DilemmaSession) {
  const data = JSON.stringify({
    ...session,
    education: session.rounds.map((r) => ({
      before: decisionInformation(session, r.index),
      after: continuationObservation(session, r),
    })),
  })
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dilemma Dynamics · Dilemma replay</title>
<style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui;max-width:900px;margin:32px auto;padding:20px;background:light-dark(#fffaf0,#10272d);color:light-dark(#183e42,#eef8e9)}h1,h2{font-weight:500}.players{display:grid;grid-template-columns:1fr 1fr;gap:20px}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid light-dark(#bed3c8,#426660)}input{width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere}button{padding:8px 14px}small{opacity:.8}@media(max-width:500px){.players{grid-template-columns:1fr}}</style>
<h1>Dilemma Dynamics / Dilemma</h1><p id="rules"></p><p id="status"></p><div class="players"><section><h2 id="a"></h2><p id="sa"></p></section><section><h2 id="b"></h2><p id="sb"></p></section></div>
<table aria-label="Payoffs to A and B"><tr><th>A / B</th><th>C</th><th>D</th></tr>${ACTIONS.map((a) => `<tr><th>${a}</th>${ACTIONS.map((b) => `<td>${payoff(a, b).join(' / ')}</td>`).join('')}</tr>`).join('')}</table>
<p id="round"></p><label>Replay round <input id="seek" type="range" min="0" value="0"></label><button id="previous">Previous</button> <button id="next">Next</button><pre id="context"></pre><pre id="analysis"></pre><pre id="following"></pre>
<small>Offline replay. No API calls. Reported expectations are not verified internal beliefs. Game points and estimated API costs are separate.</small>
<script>const s=${data};let n=0;const $=id=>document.getElementById(id);$('a').textContent=s.config.players[0].name;$('b').textContent=s.config.players[1].name;$('status').textContent=s.message+' Estimated API cost: $'+s.spentUsd.toFixed(6);$('rules').textContent=s.config.horizon.kind==='geometric'?'Maximise own expected total points. Independent ${CONTINUATION_PROBABILITY * 100}% continuation after each joint round.':'Maximise own expected total points. Fixed horizon: '+s.config.horizon.rounds+' rounds.';$('seek').max=s.rounds.length;function render(){const r=s.rounds[n-1];$('sa').textContent=(r?r.scores[0]:0)+' points'+(r?' · '+r.actions[0]+' · +'+r.payoffs[0]:'');$('sb').textContent=(r?r.scores[1]:0)+' points'+(r?' · '+r.actions[1]+' · +'+r.payoffs[1]:'');const lesson=s.education[n-1];$('context').textContent=lesson?'Known before choosing: '+lesson.before.completedRounds+' completed rounds. Neither saw the other player’s current choice. '+lesson.before.horizon:'';$('following').textContent=lesson?'What followed (retrospective): '+lesson.after:'';$('round').textContent='Viewing round '+n+' of '+s.rounds.length;$('seek').value=n;$('previous').disabled=n===0;$('next').disabled=n===s.rounds.length;$('analysis').textContent=r?r.analysis.map((a,i)=>s.config.players[i].name+': '+a.finding+(a.expectedC===null?'':' Reported expected points: C '+a.expectedC.toFixed(3)+', D '+a.expectedD.toFixed(3)+'. Report-relative loss '+a.reportedLoss.toFixed(3)+'. Brier forecast error '+a.brier.toFixed(3))+ (a.requiredFutureAdvantage?' Cooperation requires '+a.requiredFutureAdvantage.map(x=>x.toFixed(3)).join('–')+' additional expected future points.':'')).join(String.fromCharCode(10,10)):'Before play. No decision analysis yet.';}$('seek').oninput=e=>{n=+e.target.value;render()};$('previous').onclick=()=>{if(n>0)n--;render()};$('next').onclick=()=>{if(n<s.rounds.length)n++;render()};render();</script></html>`;
}
