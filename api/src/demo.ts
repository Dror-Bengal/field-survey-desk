import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { ObjectId } from 'mongodb';
import type { GeoPoint } from './db/types.js';
import { c } from './db/collections.js';

export function localAuth() {
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.GCLOUD_PROJECT !== 'demo-field-survey') {
    throw new Error('This edition requires the local identity emulator and demo-field-survey project.');
  }
  return getAuth(getApps()[0] ?? initializeApp({ projectId: 'demo-field-survey' }));
}

async function account(uid: string, email: string) {
  const auth = localAuth();
  try {
    await auth.getUser(uid);
  } catch (error) {
    if ((error as {code?: string}).code !== 'auth/user-not-found') throw error;
    await auth.createUser({ uid, email, password: 'FieldDemo2026!', emailVerified: true });
  }
}

const id = (n: number) => new ObjectId(n.toString(16).padStart(24, '0'));

export async function seedEdition() {
  const now = new Date();
  const settlement = id(1);
  const station = id(2);
  const community = 'Brookfield Community';
  const region = 'North District';
  const geo: GeoPoint = { type: 'Point', coordinates: [-1, 52] };
  const homes = [
    ['Birch', '12', 'Alex Reed', 'Casey Reed'],
    ['Birch', '14', 'Taylor Quinn', 'Jamie Quinn'],
    ['Birch', '16', 'Robin Bell'],
    ['Cedar', '22', 'Quinn Lane', 'Blair Lane'],
    ['Cedar', '24', 'Lee Stone'],
    ['Orchard', '8', 'Drew Clark', 'Avery Clark'],
  ];
  await c.settlements().updateOne({_id: settlement}, {$setOnInsert: {
    name_local:'Brookfield', name_en:'Brookfield', name_normalized:'brookfield',
    community, region, geo, polling_station_codes:['01'], voter_count:homes.reduce((n,h)=>n+h.length-2,0),
  }}, {upsert:true});
  await c.pollingStations().updateOne({_id:station}, {$setOnInsert:{
    code:'01', code_padded:'01', district_code:1, region, community, settlement:'Brookfield',
    settlement_id:settlement, address_text:'Brookfield Hall', geo, geocode_source:'manual', geocode_confidence:1,
  }}, {upsert:true});
  let n=100;
  for(const [street,house,...people] of homes) {
    for(const [i,full_name] of people.entries()) {
      const [first_name,last_name] = full_name.split(' ');
      await c.voters().updateOne({_id:id(n++)}, {$setOnInsert:{
        hh_seq:i+1, first_name, last_name, full_name, full_name_normalized:full_name.toLowerCase(),
        patronymic:'', dob:new Date('1987-05-10T00:00:00Z'), age_bucket:'adult', inferred_gender:'U',
        gender_confidence:'low', raw_address:house+' '+street, parsed:{street:street!,street_modifier:null,
        house:house!,apt:null,address_key:['Brookfield',street,house,''].join('|')}, polling_station_code:'01',
        polling_station_id:station, settlement_id:settlement, community, region, source_file:'synthetic',
        created_at:now,
      }},{upsert:true});
    }
  }
  const choices=[['A','List A'],['B','List B'],['refused','Refused'],['not_home','Not home'],
    ['undecided','Undecided'],['will_not_vote','Will not vote']] as const;
  for(const [i,[key,label]] of choices.entries()){
    await c.candidates().updateOne({_id:id(30+i)},{$setOnInsert:{
      name_local:label, name_en:label, short_local:key, short_en:key, display_order:i+1,active:true,
      ...(key==='A'||key==='B'?{type:'party' as const}:{type:'non_answer' as const,response_type:key}),
    }},{upsert:true});
  }
  const volunteer='volunteer@example.test', manager='manager@example.test';
  await account('demo-volunteer',volunteer);
  await account('demo-manager',manager);
  await c.surveyors().updateOne({firebase_uid:'demo-volunteer'},{$setOnInsert:{
    email:volunteer,full_name:'Morgan Lane',status:'active',scope:{settlements:[settlement]},
    settlements:[settlement],response_counts:{total:0,T1:0,T2:0,T3:0},notes:'',created_at:now,
  }},{upsert:true});
  await c.admins().updateOne({firebase_uid:'demo-manager'},{$setOnInsert:{
    email:manager,full_name:'Riley West',role:'admin',language:'en',
  }},{upsert:true});
}
