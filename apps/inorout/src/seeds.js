// Seed data — used only when localStorage is empty (first run)
// Replace with empty arrays for a clean production deployment

export const SEED_SQUAD = [
  { id:"p1",  name:"Dave",    type:"regular", disabled:false, priority:true,  deputy:false, status:"in",    paid:true,  owes:0,  goals:14, motm:4,  attended:18, total:20, bibCount:2, team:null, w:10, l:5,  d:3, payCount:18, lateDropouts:0, note:"", selfPaid:false },
  { id:"p2",  name:"Mike",    type:"regular", disabled:false, priority:true,  deputy:true,  status:"in",    paid:false, owes:5,  goals:11, motm:2,  attended:15, total:20, bibCount:1, team:null, w:8,  l:6,  d:1, payCount:13, lateDropouts:1, note:"", selfPaid:false },
  { id:"p3",  name:"Steve",   type:"regular", disabled:false, priority:true,  deputy:false, status:"in",    paid:true,  owes:0,  goals:8,  motm:1,  attended:17, total:20, bibCount:3, team:null, w:9,  l:6,  d:2, payCount:17, lateDropouts:0, note:"", selfPaid:false },
  { id:"p4",  name:"Jordan",  type:"regular", disabled:false, priority:false, deputy:false, status:"maybe", paid:false, owes:10, goals:6,  motm:6,  attended:14, total:20, bibCount:1, team:null, w:7,  l:5,  d:2, payCount:10, lateDropouts:2, note:"Might be late from work", selfPaid:false },
  { id:"p5",  name:"Chris",   type:"regular", disabled:false, priority:false, deputy:false, status:"out",   paid:false, owes:0,  goals:5,  motm:3,  attended:12, total:20, bibCount:1, team:null, w:6,  l:5,  d:1, payCount:11, lateDropouts:1, note:"Away this weekend", selfPaid:false },
  { id:"p6",  name:"Liam",    type:"regular", disabled:false, priority:false, deputy:false, status:"none",  paid:true,  owes:0,  goals:9,  motm:2,  attended:16, total:20, bibCount:0, team:null, w:9,  l:4,  d:3, payCount:16, lateDropouts:0, note:"", selfPaid:false },
  { id:"p7",  name:"Tom",     type:"regular", disabled:false, priority:false, deputy:false, status:"none",  paid:false, owes:6,  goals:3,  motm:0,  attended:8,  total:20, bibCount:0, team:null, w:4,  l:3,  d:1, payCount:5,  lateDropouts:3, note:"", selfPaid:false },
  { id:"p8",  name:"Paul",    type:"regular", disabled:false, priority:false, deputy:false, status:"none",  paid:false, owes:0,  goals:7,  motm:1,  attended:11, total:20, bibCount:0, team:null, w:5,  l:5,  d:1, payCount:10, lateDropouts:0, note:"", selfPaid:false },
  { id:"p9",  name:"Robbie",  type:"regular", disabled:false, priority:false, deputy:false, status:"in",    paid:true,  owes:0,  goals:4,  motm:1,  attended:9,  total:20, bibCount:0, team:null, w:5,  l:3,  d:1, payCount:9,  lateDropouts:0, note:"", selfPaid:false },
  { id:"p10", name:"Callum",  type:"regular", disabled:false, priority:false, deputy:false, status:"in",    paid:false, owes:0,  goals:6,  motm:0,  attended:10, total:20, bibCount:0, team:null, w:5,  l:4,  d:1, payCount:9,  lateDropouts:1, note:"", selfPaid:false },
  { id:"p11", name:"Hassan",  type:"regular", disabled:false, priority:false, deputy:false, status:"in",    paid:true,  owes:0,  goals:3,  motm:1,  attended:13, total:20, bibCount:0, team:null, w:7,  l:4,  d:2, payCount:13, lateDropouts:0, note:"", selfPaid:false },
  { id:"p12", name:"Declan",  type:"regular", disabled:false, priority:false, deputy:false, status:"none",  paid:false, owes:0,  goals:2,  motm:0,  attended:7,  total:20, bibCount:0, team:null, w:3,  l:3,  d:1, payCount:6,  lateDropouts:0, note:"", selfPaid:false },
  { id:"p13", name:"Kieran",  type:"regular", disabled:false, priority:false, deputy:false, status:"none",  paid:false, owes:0,  goals:5,  motm:2,  attended:14, total:20, bibCount:1, team:null, w:7,  l:5,  d:2, payCount:12, lateDropouts:1, note:"", selfPaid:false },
  { id:"p14", name:"Finbar",  type:"regular", disabled:false, priority:true,  deputy:false, status:"in",    paid:true,  owes:0,  goals:8,  motm:3,  attended:19, total:20, bibCount:2, team:null, w:11, l:5,  d:3, payCount:19, lateDropouts:0, note:"", selfPaid:false },
];

export const SEED_MATCH_HISTORY = [
  { id:"m1", date:"6 May 2026", dateShort:"6 May", teamA:["Dave","Steve","Liam","Finbar","Hassan","Callum","Kieran"], teamB:["Mike","Jordan","Chris","Tom","Paul","Robbie","Declan"], winner:"A", scoreA:5, scoreB:3, scorers:{Dave:2,Steve:1,Liam:1,Finbar:1,Mike:2,Robbie:1}, motm:"Dave", bibHolder:"Steve", payments:{Dave:true,Steve:true,Liam:true,Finbar:true,Hassan:true,Callum:true,Kieran:true,Mike:true,Jordan:false,Chris:true,Tom:false,Paul:true,Robbie:true,Declan:true}, cancelled:false },
  { id:"m2", date:"29 Apr 2026", dateShort:"29 Apr", teamA:["Mike","Jordan","Paul","Robbie","Finbar","Kieran","Declan"], teamB:["Dave","Steve","Liam","Chris","Hassan","Callum","Tom"], winner:"B", scoreA:2, scoreB:4, scorers:{Mike:1,Finbar:1,Dave:2,Liam:1,Chris:1}, motm:"Dave", bibHolder:"Mike", payments:{Dave:true,Steve:true,Liam:true,Chris:true,Hassan:true,Callum:true,Tom:true,Mike:true,Jordan:true,Paul:true,Robbie:true,Finbar:true,Kieran:false,Declan:true}, cancelled:false },
  { id:"m3", date:"22 Apr 2026", dateShort:"22 Apr", teamA:["Dave","Mike","Chris","Finbar","Hassan","Tom","Kieran"], teamB:["Steve","Jordan","Liam","Paul","Robbie","Callum","Declan"], winner:"D", scoreA:3, scoreB:3, scorers:{Dave:1,Mike:1,Finbar:1,Steve:2,Liam:1}, motm:"Steve", bibHolder:"Jordan", payments:{Dave:true,Mike:true,Chris:true,Finbar:true,Hassan:true,Tom:true,Kieran:true,Steve:true,Jordan:true,Liam:true,Paul:true,Robbie:true,Callum:true,Declan:false}, cancelled:false },
  { id:"m4", date:"15 Apr 2026", dateShort:"15 Apr", teamA:["Steve","Jordan","Paul","Callum","Finbar","Declan","Tom"], teamB:["Dave","Mike","Liam","Chris","Hassan","Robbie","Kieran"], winner:"B", scoreA:1, scoreB:3, scorers:{Jordan:1,Dave:1,Liam:1,Hassan:1}, motm:"Hassan", bibHolder:"Jordan", payments:{Steve:true,Jordan:true,Paul:true,Callum:true,Finbar:true,Declan:true,Tom:true,Dave:true,Mike:true,Liam:true,Chris:true,Hassan:true,Robbie:true,Kieran:true}, cancelled:false },
  { id:"m5", date:"8 Apr 2026", dateShort:"8 Apr", teamA:["Dave","Liam","Chris","Robbie","Finbar","Kieran","Paul"], teamB:["Mike","Steve","Jordan","Hassan","Callum","Tom","Declan"], winner:"A", scoreA:4, scoreB:2, scorers:{Dave:2,Chris:1,Finbar:1,Mike:1,Tom:1}, motm:"Dave", bibHolder:"Dave", payments:{Dave:true,Liam:true,Chris:true,Robbie:true,Finbar:true,Kieran:true,Paul:true,Mike:true,Steve:true,Jordan:true,Hassan:true,Callum:true,Tom:true,Declan:false}, cancelled:false },
  { id:"m6", date:"1 Apr 2026", dateShort:"1 Apr", teamA:[], teamB:[], winner:null, scoreA:0, scoreB:0, scorers:{}, motm:null, bibHolder:"", payments:{}, cancelled:true, cancelReason:"Venue flooded" },
];

export const SEED_BIB_HISTORY = [
  { name:"Steve",  date:"6 May",  returned:false },
  { name:"Mike",   date:"29 Apr", returned:true  },
  { name:"Jordan", date:"22 Apr", returned:true  },
  { name:"Jordan", date:"15 Apr", returned:true  },
  { name:"Dave",   date:"8 Apr",  returned:true  },
];

export const SEED_SCHEDULE = {
  dayOfWeek:"Tuesday", kickoff:"19:00", venue:"Powerleague Salford",
  opensDay:"Wednesday", opensTime:"10:00", priorityLeadMins:60,
  pricePerPlayer:6, gameIsLive:true, squadSize:14,
  gameDateTime:"2026-05-13T19:00",
  isDraft:false, isCancelled:false, cancelReason:"",
};

export const SEED_SETTINGS = {
  groupName: "Finbar's Tuesdays",
};

export const SEED_COVER = [
  { id:"c1", name:"Robbie's mate Jay", played:3, owes:0 },
  { id:"c2", name:"Tom's brother",     played:1, owes:6 },
  { id:"c3", name:"Marcus from work",  played:0, owes:0 },
];
