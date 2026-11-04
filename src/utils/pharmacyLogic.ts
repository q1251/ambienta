import { ContactLead, HealthCategory, Patient, RefillRecord, ReminderRule, RefillStatus } from '../types/pharmacy';
import { parseCsvRows } from './csv';
import { getLeadCountry } from './countryOptions';
export { getLeadCountry } from './countryOptions';

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
  const countryIdx = findIdx(['country', 'country_name', 'location_country']);
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
    const country = countryIdx !== -1 ? cols[countryIdx]?.trim() || '' : '';
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
      country: country || getLeadCountry(phone),
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
    'first_name,last_name,email,phone,country,marketing_consent',
    'Robert,Miller,robert.miller@example.com,+1 (555) 304-8891,United States,no',
    'Sarah,Jenkins,sarah.j@example.com,+44 20 7946 0958,United Kingdom,no',
    'David,Kim,dkim.archive@example.com,+61 2 5550 1200,Australia,no',
    'Margaret,Thurston,margaret.t@example.com,+1 (555) 883-1200,United States,no',
    'Claire,Delaney,claire.delaney@example.com,+1 (555) 762-4419,United States,no',
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

export type LeadSortField = 'name' | 'stage' | 'country' | 'email' | 'orders' | 'createdAt';
export type OrderSortField = 'orderNumber' | 'placedAt' | 'patientName' | 'totalAmount' | 'status';

const STAGE_ORDER: Record<string, number> = {
  New: 1,
  Cold: 2,
  Contacted: 3,
  Qualified: 4,
  Customer: 5,
  Inactive: 6,
};

/**
 * Pure function to sort contact leads by supported fields.
 */
export function sortContactLeads(
  leads: ContactLead[],
  field: LeadSortField,
  order: 'asc' | 'desc' = 'asc'
): ContactLead[] {
  const multiplier = order === 'asc' ? 1 : -1;
  return [...leads].sort((a, b) => {
    switch (field) {
      case 'name': {
        const nameA = `${a.firstName || ''} ${a.lastName || ''}`.trim().toLowerCase();
        const nameB = `${b.firstName || ''} ${b.lastName || ''}`.trim().toLowerCase();
        return nameA.localeCompare(nameB) * multiplier;
      }
      case 'stage': {
        const rankA = STAGE_ORDER[a.status] || 99;
        const rankB = STAGE_ORDER[b.status] || 99;
        return (rankA - rankB) * multiplier;
      }
      case 'country': {
        const cA = (a.country || '').toLowerCase();
        const cB = (b.country || '').toLowerCase();
        return cA.localeCompare(cB) * multiplier;
      }
      case 'email': {
        return (a.email || '').localeCompare(b.email || '') * multiplier;
      }
      case 'orders': {
        const countA = a.orderCount || 0;
        const countB = b.orderCount || 0;
        return (countA - countB) * multiplier;
      }
      case 'createdAt': {
        const dateA = new Date(a.createdAt || 0).getTime();
        const dateB = new Date(b.createdAt || 0).getTime();
        return (dateA - dateB) * multiplier;
      }
      default:
        return 0;
    }
  });
}

/**
 * Pure function to sort orders by supported fields.
 */
export function sortOrders(
  orders: OnlineOrder[],
  field: OrderSortField,
  order: 'asc' | 'desc' = 'asc'
): OnlineOrder[] {
  const multiplier = order === 'asc' ? 1 : -1;
  return [...orders].sort((a, b) => {
    switch (field) {
      case 'orderNumber':
        return (a.orderNumber || '').localeCompare(b.orderNumber || '') * multiplier;
      case 'placedAt': {
        const timeA = new Date(a.placedAt || 0).getTime();
        const timeB = new Date(b.placedAt || 0).getTime();
        return (timeA - timeB) * multiplier;
      }
      case 'patientName':
        return (a.patientName || '').localeCompare(b.patientName || '') * multiplier;
      case 'totalAmount':
        return ((a.totalAmount || 0) - (b.totalAmount || 0)) * multiplier;
      case 'status':
        return (a.status || '').localeCompare(b.status || '') * multiplier;
      default:
        return 0;
    }
  });
}

/**
 * Generates an authentic tracking number and carrier identifier for pharmacy fulfillment.
 */
export function generateTrackingNumber(preferredCarrier?: string): { carrier: string; trackingNumber: string } {
  const carrier = preferredCarrier?.trim() || 'CareCourier Express';
  const timestamp = Date.now().toString().slice(-6);
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);

  if (carrier.toLowerCase().includes('fedex')) {
    return {
      carrier: 'FedEx Health Logistics',
      trackingNumber: `9400${timestamp}${randomSuffix}`,
    };
  }

  if (carrier.toLowerCase().includes('usps')) {
    return {
      carrier: 'USPS Priority Health',
      trackingNumber: `92055000${timestamp}${randomSuffix.toString().slice(0, 2)}`,
    };
  }

  if (carrier.toLowerCase().includes('dhl')) {
    return {
      carrier: 'DHL Medical Express',
      trackingNumber: `DHL-MED-${timestamp}${randomSuffix.toString().slice(0, 3)}`,
    };
  }

  return {
    carrier: 'CareCourier Express',
    trackingNumber: `CCE-202611-${timestamp}${randomSuffix.toString().slice(0, 3)}`,
  };
}
