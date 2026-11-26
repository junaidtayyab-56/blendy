// Flavour art direction: sheet crops, placements and transition curves (unchanged from the original design).
export const PROXY='https://images.higgs.ai/?default=1&output=webp&w=2048&q=85&url=';
export const CDN='https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/';
// piece rows: [item, x, y, w, rotation, mirror, layer]
export const F=[
 {name:'Berry',bg:'#C2B0DC',file:'hf_20261117_053958_8803e421-29b1-4c24-8efd-54cae3f479b4.png',
  items:[[233,60,598,917],[1209,272,569,573],[265,1230,579,572],[1192,1192,626,641]],
  bottle:[518,138,372],
  pieces:[[2,383,178,104,0,0,'f'],[3,960,232,118,0,0,'f'],[1,295,478,129,-8,0,'f'],[1,1247,455,123,15,0,'f'],[2,968,590,110,30,0,'f'],[1,-15,590,255,0,0,'c'],[3,1282,40,200,0,0,'c']]},
 {name:'Kiwi',bg:'#B4D58A',file:'hf_20261117_053958_b5695e60-72da-4b5b-bfb7-a091d528af75.png',
  items:[[217,90,610,874],[1204,257,619,601],[250,1197,619,522],[1200,1186,633,650]],
  bottle:[504,135,403],
  pieces:[[2,376,170,144,-150,1,'f'],[3,960,228,152,0,0,'f'],[1,303,460,168,0,0,'f'],[2,1187,462,148,-25,0,'f'],[2,946,606,150,10,1,'f'],[1,-10,575,260,0,0,'c'],[3,1285,30,200,0,0,'c']]},
 {name:'Banana',bg:'#F3DA8A',file:'hf_20261117_053958_6cf14029-4bce-4c9a-b9fc-1c5b185082e3.png',
  items:[[194,76,579,873],[1205,228,596,597],[230,1181,624,648],[1193,1182,646,659]],
  bottle:[512,135,383],
  pieces:[[1,387,147,123,0,0,'f'],[2,970,223,136,-10,1,'f'],[3,298,483,132,15,0,'f'],[2,1245,462,150,20,0,'f'],[3,950,582,130,-12,0,'f'],[3,0,585,235,0,0,'c'],[1,1280,30,190,0,0,'c']]},
 {name:'Strawberry',bg:'#F2AFC0',file:'hf_20261117_055135_cbfb5a8d-c52b-4358-a6ee-d941c6c42285.png',
  items:[[226,88,594,887],[1190,216,561,653],[257,1168,604,662],[1240,1169,632,686]],
  bottle:[512,135,386],
  pieces:[[1,372,142,128,0,0,'f'],[2,955,225,117,20,0,'f'],[3,290,455,140,-10,0,'f'],[3,1250,432,135,15,0,'f'],[2,962,558,146,-15,0,'f'],[1,-10,555,245,0,0,'c'],[1,1285,35,200,20,0,'c']]}
];
export const SHADOWS=[[345,650,170,24],[720,708,320,30],[1318,638,160,22],[1045,760,150,22]];
export const LAYERS=['word','shadow','bottle','fruit','corner'];
export const FACT={word:.40,shadow:.30,bottle:.15,fruit:.55,corner:.75};
export const COV_T=[0,.031,.134,.206,.278,.34,.412,.485,.546,.583,.62,.69,.79,.85,.93,1];
export const COV_C=[0,.006,.012,.023,.047,.07,.105,.158,.246,.55,.825,.9,.94,.956,.975,1];
export const DUR=970, EASE='cubic-bezier(0.22, 0.8, 0.3, 1)';

export const sheetUrl = (f) => PROXY + encodeURIComponent(CDN + f.file);

// Stand-in sheet drawn on a canvas if the image proxy cannot be reached.
export function fallbackSheet(f){
  const S=1024, k=S/2048, c=document.createElement('canvas'); c.width=c.height=S; const g=c.getContext('2d');
  const pal={Berry:['#7b3fa0','#c2185b','#3b4aa8','#2b1b3d'],Kiwi:['#7fb041','#8bc34a','#6aa632','#4e8a24'],Banana:['#f4c430','#fbe7a1','#f6d77a','#fbe7a1'],Strawberry:['#e8455f','#e53950','#ef5f74','#e53950']}[f.name];
  const [bx,by,bw,bh]=f.items[0].map(v=>v*k);
  // bottle body
  g.fillStyle='rgba(255,255,255,.55)'; rr(g,bx+bw*.18,by+bh*.30,bw*.64,bh*.68,bw*.16); g.fill();
  g.fillStyle=pal[0]; rr(g,bx+bw*.22,by+bh*.42,bw*.56,bh*.53,bw*.12); g.fill();
  g.fillStyle='#fff'; rr(g,bx+bw*.28,by+bh*.58,bw*.44,bh*.16,bw*.04); g.fill();
  g.fillStyle=pal[0]; g.font=`800 ${bw*.1}px 'Baloo 2',sans-serif`; g.textAlign='center'; g.textBaseline='middle'; g.fillText('Blendy',bx+bw*.5,by+bh*.66);
  g.fillStyle='#f5f5f5'; rr(g,bx+bw*.3,by+bh*.2,bw*.4,bh*.12,bw*.05); g.fill();
  g.fillStyle='#4caf50';
  leaf(g,bx+bw*.5,by+bh*.21,bw*.42,-0.7); leaf(g,bx+bw*.5,by+bh*.21,bw*.36,-2.3);
  // fruit
  for(let j=1;j<4;j++){
    const [x,y,w,h]=f.items[j].map(v=>v*k), cx=x+w/2, cy=y+h/2, r=Math.min(w,h)*.46;
    const gr=g.createRadialGradient(cx-r*.3,cy-r*.3,r*.1,cx,cy,r);
    gr.addColorStop(0,'#fff'); gr.addColorStop(.25,pal[j]); gr.addColorStop(1,shade(pal[j]));
    g.fillStyle=gr; g.beginPath(); g.arc(cx,cy,r,0,7); g.fill();
    if(f.name==='Kiwi'){g.fillStyle='#e9f5c9';g.beginPath();g.arc(cx,cy,r*.35,0,7);g.fill();g.fillStyle='#222';for(let a=0;a<14;a++){const t=a/14*6.283;g.beginPath();g.ellipse(cx+Math.cos(t)*r*.5,cy+Math.sin(t)*r*.5,r*.05,r*.025,t,0,7);g.fill();}}
    if(f.name==='Strawberry'){g.fillStyle='#ffe28a';for(let a=0;a<18;a++){g.beginPath();g.ellipse(cx+(Math.random()-.5)*r*1.3,cy+(Math.random()-.5)*r*1.3,r*.03,r*.05,0,0,7);g.fill();}g.fillStyle='#43a047';leaf(g,cx,cy-r*.85,r*.6,-1.2);leaf(g,cx,cy-r*.85,r*.6,-1.9);}
    if(f.name==='Berry'){g.fillStyle='rgba(255,255,255,.18)';for(let a=0;a<10;a++){const t=a/10*6.283;g.beginPath();g.arc(cx+Math.cos(t)*r*.55,cy+Math.sin(t)*r*.55,r*.22,0,7);g.fill();}}
    if(f.name==='Banana'){g.fillStyle='rgba(160,110,20,.35)';for(let a=0;a<3;a++){const t=a/3*6.283;g.beginPath();g.ellipse(cx+Math.cos(t)*r*.15,cy+Math.sin(t)*r*.15,r*.18,r*.06,t,0,7);g.fill();}}
  }
  return c.toDataURL('image/png');
  function rr(g,x,y,w,h,r){g.beginPath();g.roundRect?g.roundRect(x,y,w,h,r):g.rect(x,y,w,h);}
  function leaf(g,x,y,l,a){g.save();g.translate(x,y);g.rotate(a);g.beginPath();g.moveTo(0,0);g.quadraticCurveTo(l*.5,-l*.35,l,0);g.quadraticCurveTo(l*.5,l*.35,0,0);g.fill();g.restore();}
  function shade(h){const n=parseInt(h.slice(1),16),m=v=>Math.max(0,Math.round(v*.7));return `rgb(${m(n>>16)},${m(n>>8&255)},${m(n&255)})`;}
}
