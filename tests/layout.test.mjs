import test from 'node:test';
import assert from 'node:assert/strict';
import {mmToPx,computeCrop,computeSheet,pickQuality} from '../layout.js';
import {getSpec} from '../specs.js';

test('300dpi mm 변환',()=>{for(const [mm,pixels] of [[35,413],[45,531],[50.8,600],[30,354],[40,472]])assert.equal(mmToPx(mm),pixels);});
const det={crownY:300,chinY:700,eyeY:520,centerX:500,crownUncertain:false};
test('한국 여권 얼굴 배치',()=>{const crop=computeCrop(getSpec('kr-passport'),det,1000,1500);assert.ok(Math.abs(crop.headMm-34)<.1);assert.equal(crop.ok,true);});
test('미국 눈높이 배치',()=>{const crop=computeCrop(getSpec('us-passport'),det,1000,1500);assert.ok(Math.abs(crop.eyeFromBottomMm-31.75)<.1);assert.ok(crop.headMm>=25.4&&crop.headMm<=34.9);});
test('머리 잘림 불확실 경고',()=>{const crop=computeCrop(getSpec('kr-passport'),{...det,crownUncertain:true},1000,1500);assert.equal(crop.ok,false);assert.ok(crop.problems.some(p=>p.includes('잘린 것')));});
test('세로 보정으로 머리 출력 밖 판정',()=>{const crop=computeCrop(getSpec('kr-passport'),det,1000,1500,{dyMm:-12});assert.ok(Math.abs(crop.headMm-34)<.1);assert.equal(crop.ok,false);assert.ok(crop.problems.includes('머리가 사진 밖으로 나갔습니다'));});
test('크기 보정 범위 판정',()=>{const crop=computeCrop(getSpec('kr-passport'),det,1000,1500,{scale:1.15});assert.ok(Math.abs(crop.headMm-39.1)<.2);assert.equal(crop.ok,false);});
test('원본 여백 부족 흰 띠',()=>{const crop=computeCrop(getSpec('kr-passport'),{...det,crownY:20,chinY:420},1000,1500);assert.ok(crop.problems.includes('원본에 여백이 부족해 흰 띠가 생겼습니다'));});
test('모음판 후보 네 가지, 장수·크기·경계·겹침',()=>{
  for(const [id,count,orientation,gap] of [['kr-passport',8,'landscape',24],['kr-half',10,'landscape',0],['us-passport',6,'landscape',0]]){
    const spec=getSpec(id),sheet=computeSheet(spec);assert.equal(sheet.count,count);assert.equal(sheet.orientation,orientation);assert.equal(sheet.gap,gap);
    for(const candidate of sheet.candidates){const {cols,rows,count:items}=candidate;assert.equal(items,cols*rows);}
    const singleW=mmToPx(spec.widthMm),singleH=mmToPx(spec.heightMm);assert.equal(sheet.tiles.length,count);
    for(const tile of sheet.tiles){assert.equal(tile.w,singleW);assert.equal(tile.h,singleH);assert.ok(tile.x>=0&&tile.y>=0&&tile.x+tile.w<=sheet.W&&tile.y+tile.h<=sheet.H);}
    for(let a=0;a<sheet.tiles.length;a++)for(let b=a+1;b<sheet.tiles.length;b++){const x=sheet.tiles[a],y=sheet.tiles[b];assert.ok(x.x+x.w<=y.x||y.x+y.w<=x.x||x.y+x.h<=y.y||y.y+y.h<=x.y);}
  }
  const half=computeSheet(getSpec('kr-half'));assert.equal(half.candidates.find(c=>c.orientation==='landscape'&&c.gap===24).count,8);assert.equal(half.candidates.find(c=>c.orientation==='portrait'&&c.gap===24).count,9);
});
test('품질 탐색 0.92, 중간, 0.30 통과, 초과 실패',async()=>{
  let tried=[];assert.equal((await pickQuality(async q=>(tried.push(q),{size:100}),100)).quality,.92);
  tried=[];const mid=await pickQuality(async q=>(tried.push(q),{size:q<=.72?90:110}),100);assert.ok(mid.quality<.92&&mid.quality>=.32);
  tried=[];const last=await pickQuality(async q=>(tried.push(q),{size:q===.30?90:110}),100);assert.equal(last.quality,.30);assert.ok(tried.includes(.30));
  tried=[];const fail=await pickQuality(async q=>(tried.push(q),{size:101}),100);assert.equal(fail.ok,false);assert.ok(tried.includes(.30));
});
test('위로 버튼(dyMm+1)은 얼굴을 위로 1mm 올린다',()=>{const spec=getSpec('kr-passport'),base=computeCrop(spec,det,1000,1500),up=computeCrop(spec,det,1000,1500,{dyMm:1});const top=c=>(det.crownY-c.y)/c.h*spec.heightMm;assert.ok(Math.abs(top(base)-top(up)-1)<.01);});
