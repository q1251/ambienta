import { ContactLead, HealthCategory, Patient, RefillRecord, ReminderRule, RefillStatus } from '../types/pharmacy';
import { parseCsvRows } from './csv';

/**
 * Calculates remaining days from a reference date (or today) to a target date string.
 */
export function calculateDaysRemaining(targetDateStr: string, referenceDateStr?: string): number {
  if (!targetDateStr) return 0;
  const refDate = referenceDateStr ? new Date(referenceDateStr) : new Date('2026-11-02T12:00:00Z');
  const targetDate = new Date(targetDateStr);
  const diffTime = targetDate.getTime() - refDate.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Computes refill status based on remaining refills and days remaining.
 */
export function determineRefillStatus(remainingRefills: number, daysRemaining: number): RefillStatus {
  if (remainingRefills <= 0) {
    return 'Renewal Required';
  }
  if (daysRemaining < 0) {
    return 'Overdue';
  }
  if (daysRemaining <= 5) {
    return 'Due Soon';
  }
  return 'Active';
}

/**
 * Replaces token placeholders like {{patient_name}}, {{rx_number}}, {{medication}}, {{renewal_date}} with actual values.
 */
export function interpolateEmailTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, val] of Object.entries(vars)) {
    const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
    result = result.replace(regex, val || '');
  }
  return result;
}

/**
 * Filters patient list by health category segment.
 */
export function filterPatientsByHealthCategory(
  patients: Patient[],
  category: HealthCategory | 'All Patients'
): Patient[] {
  if (category === 'All Patients') {
    return patients;
  }
  return patients.filter((p) => p.healthCategory === category);
}

export interface CsvParseResult {
  leads: Omit<ContactLead, 'id' | 'createdAt'>[];
  errors: string[];
  totalParsed: number;
}

/**
 * Parses contact-only CSV data. Clinical and prescription columns are ignored.
 */
export function parseLeadsCsv(csvText: string): CsvParseResult {
  const errors: string[] = [];
  const leads: Omit<ContactLead, 'id' | 'createdAt'>[] = [];

  if (!csvText || !csvText.trim()) {
    return { leads: [], errors: ['CSV content is empty.'], totalParsed: 0 };
  }

  let rows: string[][];
  try {
    rows = parseCsvRows(csvText);
  } catch (error) {
    return {
      leads: [],
      errors: [error instanceof Error ? error.message : 'CSV could not be parsed.'],
      totalParsed: 0,
    };
  }
  if (rows.length < 2) {
    return { leads: [], errors: ['CSV must have a header row and at least one data row.'], totalParsed: 0 };
  }
  if (rows.length > 501) {
    return { leads: [], errors: ['A contact import can contain at most 500 rows.'], totalParsed: 0 };
  }

  const headers = rows[0].map((header) => header.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const findIdx = (names: string[]) => headers.findIndex((header) => names.includes(header));
  const fnIdx = findIdx(['first_name', 'firstname', 'first']);
  const lnIdx = findIdx(['last_name', 'lastname', 'last']);
  const emailIdx = findIdx(['email', 'mail']);
  const phoneIdx = findIdx(['phone', 'mobile', 'tel']);
  const consentIdx = findIdx(['marketing_consent', 'marketing_opt_in', 'consent']);
  if (emailIdx === -1 || fnIdx === -1 || lnIdx === -1) {
    errors.push('CSV header must contain first_name, last_name, and email columns.');
    return { leads: [], errors, totalParsed: 0 };
  }

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const cols = rows[rowIndex];
    const firstName = cols[fnIdx] || '';
    const lastName = cols[lnIdx] || '';
    const email = (cols[emailIdx] || '').toLowerCase();
    const phone = phoneIdx !== -1 ? cols[phoneIdx] || '' : '';
    if (!firstName || !lastName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push(`Row ${rowIndex + 1}: Skipped row due to missing name or valid email.`);
      continue;
    }
    const consentValue = consentIdx === -1 ? '' : (cols[consentIdx] || '').toLowerCase();

    leads.push({
      firstName,
      lastName,
      leadSource: 'CSV Upload',
      email,
      phone,
      status: 'Cold',
      marketingConsent: ['yes', 'true', '1', 'opted in'].includes(consentValue),
    });
  }

  return { leads, errors, totalParsed: leads.length };
}

/**
 * Generates sample CSV string for users to download and inspect.
 */
export function generateSampleCsv(): string {
  return [
    'first_name,last_name,email,phone,marketing_consent',
    'Robert,Miller,robert.miller@example.com,+1 (555) 304-8891,no',
    'Sarah,Jenkins,sarah.j@example.com,+1 (555) 441-9923,no',
    'David,Kim,dkim.archive@example.com,+1 (555) 912-3341,no',
    'Margaret,Thurston,margaret.t@example.com,+1 (555) 883-1200,no',
    'Claire,Delaney,claire.delaney@example.com,+1 (555) 762-4419,no',
  ].join('\n');
}

/**
 * Identifies upcoming renewal triggers for patient refill records based on configured reminder rules.
 */
export function evaluateDueReminders(
  patients: Patient[],
  rules: ReminderRule[],
  currentDateStr = '2026-11-02'
): { patient: Patient; record: RefillRecord; rule: ReminderRule; daysLeft: number }[] {
  const matches: { patient: Patient; record: RefillRecord; rule: ReminderRule; daysLeft: number }[] = [];
  const activeRules = rules.filter((r) => r.isActive);

  for (const patient of patients) {
    for (const record of patient.refillHistory) {
      const daysLeft = calculateDaysRemaining(record.nextRefillDue, currentDateStr);

      for (const rule of activeRules) {
        // Trigger if daysLeft equals rule days or is within threshold
        if (daysLeft <= rule.daysBeforeDue && daysLeft >= 0) {
          matches.push({ patient, record, rule, daysLeft });
          break; // Avoid duplicate rule firings for the same record in one scan
        }
      }
    }
  }

  return matches;
}
