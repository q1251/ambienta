import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDaysRemaining,
  getLocalDateString,
  determineRefillStatus,
  interpolateEmailTemplate,
  filterPatientsByHealthCategory,
  getLeadCountry,
  classifyLeadContact,
  parseLeadsCsv,
  evaluateDueReminders,
  sortContactLeads,
  sortOrders,
  generateTrackingNumber,
} from './pharmacyLogic';
import { countryOptions, getLeadCountryCode, getLeadCountryLabel, phoneInputParts } from './countryOptions';
import { Patient, ReminderRule } from '../types/pharmacy';

test('calculateDaysRemaining computes correct difference', () => {
  const ref = '2026-11-02T12:00:00Z';
  assert.equal(calculateDaysRemaining('2026-11-05T12:00:00Z', ref), 3);
  assert.equal(calculateDaysRemaining('2026-11-02T12:00:00Z', ref), 0);
  assert.equal(calculateDaysRemaining('2026-10-31T12:00:00Z', ref), -2);
});

test('calculateDaysRemaining uses the current local calendar day when no reference date is provided', () => {
  assert.match(getLocalDateString(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(calculateDaysRemaining(getLocalDateString()), 0);
});

test('determineRefillStatus correctly flags overdue, due soon, and renewal required', () => {
  assert.equal(determineRefillStatus(0, 10), 'Renewal Required');
  assert.equal(determineRefillStatus(2, -1), 'Overdue');
  assert.equal(determineRefillStatus(2, 3), 'Due Soon');
  assert.equal(determineRefillStatus(2, 14), 'Active');
});

test('interpolateEmailTemplate properly replaces dynamic variable tokens', () => {
  const template = 'Hello {{patient_name}}, your refill for {{medication}} (Rx #{{rx_number}}) is scheduled for {{renewal_date}}.';
  const vars = {
    patient_name: 'Eleanor Vance',
    medication: 'Metformin 500mg',
    rx_number: 'RX-884219',
    renewal_date: 'Nov 6, 2026',
  };
  const result = interpolateEmailTemplate(template, vars);
  assert.equal(
    result,
    'Hello Eleanor Vance, your refill for Metformin 500mg (Rx #RX-884219) is scheduled for Nov 6, 2026.'
  );
});

test('parseLeadsCsv keeps only contact fields and ignores clinical CSV columns', () => {
  const sampleCsv = `first_name,last_name,email,phone,marketing_consent,health_category,medication_name,rx_number,renewal_date,primary_doctor
George,Patton,george@example.com,555-1234,no,Cardiology,Atorvastatin 20mg,RX-112233,2026-11-08,Dr. House
Maya,Lin,maya@example.com,555-5678,yes,Diabetes,Metformin 1000mg,RX-445566,2026-11-05,Dr. Smith`;

  const parsed = parseLeadsCsv(sampleCsv);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.leads.length, 2);
  assert.equal(parsed.leads[0].firstName, 'George');
  assert.equal(parsed.leads[0].email, 'george@example.com');
  assert.equal(parsed.leads[0].country, 'Not specified');
  assert.equal(parsed.leads[1].firstName, 'Maya');
  assert.equal(parsed.leads[0].status, 'Cold');
  assert.equal(parsed.leads[0].marketingConsent, false);
  assert.equal(parsed.leads[1].marketingConsent, true);
  assert.equal('healthCategory' in parsed.leads[0], false);
  assert.equal('refillHistory' in parsed.leads[0], false);
});

test('getLeadCountry detects supported international calling codes without guessing local numbers', () => {
  assert.equal(getLeadCountry('+1 (555) 123-4567'), 'North America (+1)');
  assert.equal(getLeadCountry('+1 213 373 4253'), 'United States');
  assert.equal(getLeadCountry('0044 20 7946 0958'), 'United Kingdom');
  assert.equal(getLeadCountry('+971 50 123 4567'), 'United Arab Emirates');
  assert.equal(getLeadCountry('555-0120'), 'Not specified');
  assert.equal(getLeadCountry(''), 'Not specified');
});

test('country selectors include the full supported calling-code list and split international numbers', () => {
  assert.ok(countryOptions.length > 200);
  assert.ok(countryOptions.every((country) => country.callingCode && country.flag));
  assert.deepEqual(phoneInputParts('+44 20 7946 0958'), {
    countryCode: 'GB',
    nationalNumber: '2079460958',
  });
  assert.deepEqual(phoneInputParts('555-0120'), {
    countryCode: '',
    nationalNumber: '5550120',
  });
  assert.equal(getLeadCountryCode('Canada', '+44 20 7946 0958'), 'CA');
  assert.equal(getLeadCountryCode('US', '+44 20 7946 0958'), 'US');
  assert.equal(getLeadCountryCode('usa', ''), 'US');
  assert.equal(getLeadCountryCode('90210', '+44 20 7946 0958'), 'GB');
  assert.equal(getLeadCountryCode('', '+44 20 7946 0958'), 'GB');
  assert.equal(getLeadCountryCode('Not specified', '+44 20 7946 0958'), 'GB');
  assert.equal(getLeadCountryCode('Somewhere else', '+44 20 7946 0958'), '');
  assert.equal(getLeadCountryLabel('US', '+44 20 7946 0958'), 'United States');
  assert.equal(getLeadCountryLabel('', '+1 213 373 4253'), 'United States');
  assert.equal(getLeadCountryLabel('90210', ''), 'Not specified');
  assert.equal(getLeadCountryLabel('90210', '+44 20 7946 0958'), 'United Kingdom');
});

test('parseLeadsCsv keeps explicit country values and infers one from phone when absent', () => {
  const parsed = parseLeadsCsv([
    'first_name,last_name,email,phone,country',
    'Ava,Stone,ava@example.com,555-0101,Canada',
    'Noah,Reed,noah@example.com,+44 20 7946 0958,',
    'Mia,Lin,mia@example.com,+44 20 7946 0958,US',
  ].join('\n'));

  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.leads[0].country, 'Canada');
  assert.equal(parsed.leads[1].country, 'United Kingdom');
  assert.equal(parsed.leads[2].country, 'United States');
});

test('contact classification distinguishes completeness without inferring marketing consent', () => {
  assert.equal(classifyLeadContact({ firstName: 'Ava', lastName: 'Stone', email: 'ava@example.com', phone: '+1 213 373 4253' }), 'full_contact');
  assert.equal(classifyLeadContact({ firstName: '', lastName: '', email: 'ava@example.com', phone: '+1 213 373 4253' }), 'email_phone');
  assert.equal(classifyLeadContact({ firstName: 'Ava', lastName: 'Stone', email: 'ava@example.com', phone: '' }), 'email_name');
  assert.equal(classifyLeadContact({ firstName: '', lastName: '', email: 'ava@example.com', phone: '' }), 'email_only');
  assert.equal(classifyLeadContact({ firstName: 'Ava', lastName: 'Stone', email: '', phone: '+1 213 373 4253' }), 'phone_name');
  assert.equal(classifyLeadContact({ firstName: '', lastName: '', email: '', phone: '+1 213 373 4253' }), 'phone_only');
  assert.equal(classifyLeadContact({ firstName: '', lastName: '', email: '', phone: '', postalCode: '90210-1234' }), 'address_only');
});

test('parseLeadsCsv imports email-only and phone-only contacts and merges duplicates', () => {
  const parsed = parseLeadsCsv([
    'first_name,last_name,email,phone,marketing_consent,medication_name',
    ',,only@example.com,,,ignored',
    'Ava,Stone,ava@example.com,+1 213 373 4253,no,ignored',
    'Ava,Stone,AVA@example.com,+1 213 373 4253,,,',
    'Jordan,Reed,,555-1234,,ignored',
    'Jordan,Reed,,555-1234,,ignored',
  ].join('\n'));

  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.leads.length, 3);
  assert.equal(parsed.leads[0].firstName, '');
  assert.equal(parsed.leads[0].marketingConsent, false);
  assert.equal(parsed.leads[1].firstName, 'Ava');
  assert.equal(parsed.leads[2].firstName, 'Jordan');
  assert.equal(parsed.leads[2].email, '');
  assert.equal('medicationName' in parsed.leads[2], false);
});

test('parseLeadsCsv drops malformed email values while preserving valid alternate contacts', () => {
  const parsed = parseLeadsCsv([
    'first_name,last_name,email,phone,address',
    'Ava,Stone,ava..stone@example.com,+1 213 373 4253,',
    'Noah,Reed,noah..reed@example.com,,12 Oak Street',
    'Mia,Lin,mia..lin@example.com,,',
  ].join('\n'));

  assert.equal(parsed.leads.length, 2);
  assert.equal(parsed.leads[0].email, '');
  assert.equal(parsed.leads[0].phone, '+1 213 373 4253');
  assert.equal(parsed.leads[1].email, '');
  assert.equal(parsed.leads[1].address, '12 Oak Street');
  assert.equal(parsed.errors.length, 1);
});

test('parseLeadsCsv preserves addresses and separately imports explicit order history fields', () => {
  const parsed = parseLeadsCsv([
    'first_name,last_name,email,phone,postal_code,address,order_number,order_date,product_name,tracking_number,carrier,source_key,source_sheet,medication_name,rx_number',
    'Ava,Stone,ava@example.com,+1 213 373 4253,90210,12 Oak Street,ORD-1,2025-03-04,Wellness item,1Z999AA10123456784,UPS,stable-order-1,Sheet7,ignored,ignored',
    ',,ava@example.com,+1 213 373 4253,90210,12 Oak Street,ORD-2,2025-03-05,Another item,,,,,ignored,ignored',
  ].join('\n'));

  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.leads.length, 1);
  assert.equal(parsed.leads[0].address, '12 Oak Street');
  assert.equal(parsed.leads[0].phone, '+1 213 373 4253');
  assert.equal(parsed.historicalOrders.length, 2);
  assert.equal(parsed.historicalOrders[0].orderNumber, 'ORD-1');
  assert.equal(parsed.historicalOrders[0].trackingNumber, '1Z999AA10123456784');
  assert.equal(parsed.historicalOrders[0].sourceKey, 'stable-order-1');
  assert.equal(parsed.historicalOrders[0].sourceSheet, 'Sheet7');
  assert.equal('medicationName' in parsed.historicalOrders[0], false);
});

test('parseLeadsCsv preserves additional emails and phones in admin-only source records without sensitive fields', () => {
  const sourceData = JSON.stringify({
    email: 'first@example.com; second@example.com',
    email_2: 'third@example.com',
    phone: '555-0101; 555-0102',
    card_number: '4111111111111111',
    cc_number: '4111111111111111',
    cvv: '123',
    diagnosis: 'private clinical data',
    unknown_column: '4111 1111 1111 1111',
  });
  const fields = [
    'first_name',
    'last_name',
    'email',
    'email_2',
    'phone',
    'source_file',
    'source_sheet',
    'source_row',
    'source_key',
    'source_data',
  ];
  const csvValue = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const parsed = parseLeadsCsv([
    fields.join(','),
    ['Ava', 'Stone', 'first@example.com; second@example.com', 'third@example.com', '555-0101; 555-0102',
      'contacts.xlsx', 'Sheet1', '7', 'source-hash', sourceData].map(csvValue).join(','),
  ].join('\n'));

  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(parsed.leads.slice(0, 3).map((lead) => lead.email), [
    'first@example.com',
    'second@example.com',
    'third@example.com',
  ]);
  assert.deepEqual(parsed.leads.slice(3).map((lead) => lead.phone), ['555-0101', '555-0102']);
  assert.equal(parsed.sourceRecords.length, 5);
  assert.equal(parsed.sourceRecords[0].sourceFile, 'contacts.xlsx');
  assert.equal(parsed.sourceRecords[0].sourceRow, 7);
  assert.equal('card_number' in parsed.sourceRecords[0].data, false);
  assert.equal('cc_number' in parsed.sourceRecords[0].data, false);
  assert.equal('cvv' in parsed.sourceRecords[0].data, false);
  assert.equal('diagnosis' in parsed.sourceRecords[0].data, false);
  assert.equal('unknown_column' in parsed.sourceRecords[0].data, false);
});

test('parseLeadsCsv treats ZIP+4 values as postal codes and retains address-only records', () => {
  const parsed = parseLeadsCsv([
    'first_name,last_name,email,phone,postal_code,address',
    ',,,90210-1234,,',
    ',,, ,90210-1234,',
    ',,,,,24 Oak Street',
    'Ava,Stone,,90210,90210,1 Oak Street',
    'Ben,Stone,,,90210,2 Oak Street',
  ].join('\n'));

  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.leads.length, 4);
  assert.equal(parsed.leads[0].phone, '');
  assert.equal(parsed.leads[0].postalCode, '90210-1234');
  assert.equal(parsed.leads[1].address, '24 Oak Street');
  assert.equal(classifyLeadContact(parsed.leads[0]), 'address_only');
  assert.equal(parsed.leads[2].phone, '');
  assert.equal(parsed.leads[2].address, '1 Oak Street');
  assert.equal(parsed.leads[3].address, '2 Oak Street');
});

test('filterPatientsByHealthCategory isolates requested segments', () => {
  const mockPatients = [
    { id: '1', firstName: 'Alice', healthCategory: 'Diabetes Care' } as Patient,
    { id: '2', firstName: 'Bob', healthCategory: 'Cardiology / Hypertension' } as Patient,
    { id: '3', firstName: 'Charlie', healthCategory: 'Diabetes Care' } as Patient,
  ];

  const diabetesOnly = filterPatientsByHealthCategory(mockPatients, 'Diabetes Care');
  assert.equal(diabetesOnly.length, 2);
  assert.equal(diabetesOnly[0].firstName, 'Alice');

  const all = filterPatientsByHealthCategory(mockPatients, 'All Patients');
  assert.equal(all.length, 3);
});

test('evaluateDueReminders detects records within active threshold', () => {
  const mockPatient: Patient = {
    id: 'p1',
    firstName: 'Eleanor',
    lastName: 'Vance',
    email: 'eleanor@test.com',
    phone: '555-0101',
    dateOfBirth: '1962-04-12',
    address: '123 Main St',
    insuranceProvider: 'BlueCross',
    insurancePolicyNumber: 'BC-99120',
    healthCategory: 'Diabetes Care',
    primaryDoctor: 'Dr. Ross',
    allergies: ['Penicillin'],
    activeMedicationsCount: 1,
    nextRenewalDate: '2026-11-05',
    leadSource: 'Online Order',
    createdAt: '2026-09-01',
    notes: [],
    refillHistory: [
      {
        id: 'r1',
        rxNumber: 'RX-12345',
        medicationName: 'Metformin',
        strength: '500mg',
        dosageForm: 'Tablet',
        quantity: 30,
        daysSupply: 30,
        providerDoctor: 'Dr. Ross',
        doctorClinic: 'City Health',
        dateFilled: '2026-10-06',
        nextRefillDue: '2026-11-05', // 3 days from 2026-11-02
        remainingRefills: 2,
        status: 'Due Soon',
        refillInstructions: 'Once daily with meals',
      },
    ],
  };

  const rules: ReminderRule[] = [
    {
      id: 'rule-3d',
      daysBeforeDue: 5,
      title: '5-Day Refill Advance Notice',
      subjectTemplate: 'Refill Due Soon: {{medication}}',
      bodyTemplate: 'Please confirm your refill.',
      isActive: true,
    },
  ];

  const due = evaluateDueReminders([mockPatient], rules, '2026-11-02');
  assert.equal(due.length, 1);
  assert.equal(due[0].patient.firstName, 'Eleanor');
  assert.equal(due[0].daysLeft, 3);
});

test('sortContactLeads sorts alphabetically, by stage priority, by orders, and by date', () => {
  const sampleLeads: any[] = [
    { id: 1, firstName: 'Zach', lastName: 'Taylor', status: 'New', country: 'United States', email: 'z@example.com', orderCount: 1, createdAt: '2026-10-01' },
    { id: 2, firstName: 'Alice', lastName: 'Brown', status: 'Customer', country: 'Canada', email: 'a@example.com', orderCount: 5, createdAt: '2026-10-05' },
    { id: 3, firstName: 'Brian', lastName: 'Adams', status: 'Cold', country: 'United Kingdom', email: 'b@example.com', orderCount: 0, createdAt: '2026-10-03' },
  ];

  const sortedByName = sortContactLeads(sampleLeads, 'name', 'asc');
  assert.equal(sortedByName[0].firstName, 'Alice');
  assert.equal(sortedByName[2].firstName, 'Zach');

  const sortedByNameDesc = sortContactLeads(sampleLeads, 'name', 'desc');
  assert.equal(sortedByNameDesc[0].firstName, 'Zach');
  assert.equal(sortedByNameDesc[2].firstName, 'Alice');

  const sortedByStage = sortContactLeads(sampleLeads, 'stage', 'asc');
  assert.equal(sortedByStage[0].status, 'New');
  assert.equal(sortedByStage[1].status, 'Cold');
  assert.equal(sortedByStage[2].status, 'Customer');

  const sortedByOrders = sortContactLeads(sampleLeads, 'orders', 'desc');
  assert.equal(sortedByOrders[0].orderCount, 5);
  assert.equal(sortedByOrders[2].orderCount, 0);
});

test('sortOrders sorts by total amount and order date accurately', () => {
  const sampleOrders: any[] = [
    { id: '1', orderNumber: 'ORD-101', placedAt: '2026-11-01', patientName: 'Alice', totalAmount: 45.0, status: 'Pending' },
    { id: '2', orderNumber: 'ORD-102', placedAt: '2026-11-03', patientName: 'Bob', totalAmount: 120.0, status: 'Shipped' },
    { id: '3', orderNumber: 'ORD-103', placedAt: '2026-11-02', patientName: 'Charlie', totalAmount: 75.0, status: 'Delivered' },
  ];

  const sortedByAmount = sortOrders(sampleOrders, 'totalAmount', 'desc');
  assert.equal(sortedByAmount[0].totalAmount, 120.0);
  assert.equal(sortedByAmount[2].totalAmount, 45.0);

  const sortedByDate = sortOrders(sampleOrders, 'placedAt', 'desc');
  assert.equal(sortedByDate[0].orderNumber, 'ORD-102');
  assert.equal(sortedByDate[2].orderNumber, 'ORD-101');
});

test('generateTrackingNumber produces valid carrier prefix and tracking code', () => {
  const defaultTrack = generateTrackingNumber();
  assert.equal(defaultTrack.carrier, 'CareCourier Express');
  assert.ok(defaultTrack.trackingNumber.startsWith('CCE-202611-'));

  const fedexTrack = generateTrackingNumber('FedEx');
  assert.equal(fedexTrack.carrier, 'FedEx Health Logistics');
  assert.ok(fedexTrack.trackingNumber.startsWith('9400'));

  const uspsTrack = generateTrackingNumber('USPS Priority');
  assert.equal(uspsTrack.carrier, 'USPS Priority Health');
  assert.ok(uspsTrack.trackingNumber.startsWith('92055000'));
});
