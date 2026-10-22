// Consume the native parser's JSON on stdin. Never write private rows to disk or stdout.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reviewCertificate,mergeCertificate} from '../assets/certificate-import.mjs';
import {today,addDays,validDate,DEFAULT_RULES,clone} from '../assets/engine.mjs';
const payload=JSON.parse(readFileSync(0,'utf8')),date=process.argv[2]||today();
assert.ok(validDate(date),'Verification reference must be YYYY-MM-DD');
const state={version:1,rules:clone(DEFAULT_RULES),records:[],plans:[],complete:false,appliedImports:[]};
const review=reviewCertificate(payload,state.records,state.plans,date);
assert.equal(review.length,payload.expected);assert.ok(review.every(row=>row.selected));
let id=0;
const merged=mergeCertificate(state,payload,review.map(row=>row.index),date,()=>`verify-${++id}`);
assert.equal(merged.added,payload.expected);assert.equal(state.records.length,0);
assert.ok(merged.state.records.every(row=>Object.keys(row).sort().join(',')==='date,id,type'));
assert.ok(reviewCertificate(payload,merged.state.records,[],date).every(row=>row.status==='duplicate'&&!row.selected));
const latest=review.reduce((max,row)=>row.date>max?row.date:max,'');
assert.throws(()=>reviewCertificate(payload,[],[],addDays(latest,-1)),error=>error.code==='future-date');
assert.throws(()=>reviewCertificate(payload,[],[],'10/19/2026'),error=>error.code==='current-date');
console.log(JSON.stringify({reviewed:review.length,merged:merged.added,duplicates_excluded:true,clock_error_identified:true,no_original_state_changes:true}));
