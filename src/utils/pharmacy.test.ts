import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDaysRemaining,
  determineRefillStatus,
  interpolateEmailTemplate,
  filterPatientsByHealthCategory,
  getLeadCountry,
  parseLeadsCsv,
  evaluateDueReminders,
} from './pharmacyLogic';
import { Patient, ReminderRule } from '../types/pharmacy';

test('calculateDaysRemaining computes correct difference', () => {
  const ref = '2026-11-02T12:00:00Z';
  assert.equal(calculateDaysRemaining('2026-11-05T12:00:00Z', ref), 3);
  assert.equal(calculateDaysRemaining('2026-11-02T12:00:00Z', ref), 0);
  assert.equal(calculateDaysRemaining('2026-10-31T12:00:00Z', ref), -2);
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
  assert.equal(getLeadCountry('0044 20 7946 0958'), 'United Kingdom');
  assert.equal(getLeadCountry('+971 50 123 4567'), 'United Arab Emirates');
  assert.equal(getLeadCountry('555-0120'), 'Not specified');
  assert.equal(getLeadCountry(''), 'Not specified');
});

test('parseLeadsCsv keeps explicit country values and infers one from phone when absent', () => {
  const parsed = parseLeadsCsv([
    'first_name,last_name,email,phone,country',
    'Ava,Stone,ava@example.com,555-0101,Canada',
    'Noah,Reed,noah@example.com,+44 20 7946 0958,',
  ].join('\n'));

  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.leads[0].country, 'Canada');
  assert.equal(parsed.leads[1].country, 'United Kingdom');
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
