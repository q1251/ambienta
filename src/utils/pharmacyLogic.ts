import {
  ContactLead,
  HealthCategory,
  LeadContactCompleteness,
  LeadHistoryImportInput,
  LeadSourceRecordImportInput,
  OnlineOrder,
  Patient,
  RefillRecord,
  ReminderRule,
  RefillStatus,
} from '../types/pharmacy';
import { parseCsvRows } from './csv';
import { getLeadCountry, getLeadCountryLabel } from './countryOptions';
export { getLeadCountry } from './countryOptions';

/**
 * Calculates remaining days from a reference date (or today) to a target date string.
 */
export function getLocalDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const parseCalendarDate = (value: string): Date => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value);
  date.setHours(12, 0, 0, 0);
  return date;
};

export function calculateDaysRemaining(targetDateStr: string, referenceDateStr?: string): number {
  if (!targetDateStr) return 0;
  const refDate = parseCalendarDate(referenceDateStr || getLocalDateString());
  const targetDate = parseCalendarDate(targetDateStr);
  const diffTime = targetDate.getTime() - refDate.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
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
  historicalOrders: LeadHistoryImportInput[];
  sourceRecords: LeadSourceRecordImportInput[];
  errors: string[];
  totalParsed: number;
}

export function isValidLeadEmail(email: string): boolean {
  if (email.length > 254 || email.includes('..')) return false;
  const [local, domain, ...extra] = email.split('@');
  if (!local || !domain || extra.length > 0 || local.length > 64 || local.startsWith('.') || local.endsWith('.')) {
    return false;
  }
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return false;
  return /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(domain);
}

function containsPossiblePaymentCardNumber(value: string, fieldName = ''): boolean {
  if (/(?:email|e-mail|mail|tracking|order|invoice|date|time)/i.test(fieldName)) return false;
  const candidates = value.match(/(?:^|[^\d])(?:\d[\s-]?){13,19}(?:[^\d]|$)/g) || [];
  return candidates.some((candidate) => {
    const digits = candidate.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    let doubleDigit = false;
    for (let index = digits.length - 1; index >= 0; index -= 1) {
      let digit = Number(digits[index]);
      if (doubleDigit) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      doubleDigit = !doubleDigit;
    }
    return sum % 10 === 0;
  });
}

export function classifyLeadContact(lead: Pick<ContactLead, 'firstName' | 'lastName' | 'email' | 'phone' | 'address' | 'postalCode'>): LeadContactCompleteness {
  const hasEmail = isValidLeadEmail(lead.email.trim());
  const hasPhone = lead.phone.replace(/\D/g, '').length >= 7;
  const hasFullName = Boolean(lead.firstName.trim() && lead.lastName.trim());
  const hasName = Boolean(lead.firstName.trim() || lead.lastName.trim());

  if (hasEmail && hasPhone && hasFullName) return 'full_contact';
  if (hasEmail && hasPhone) return 'email_phone';
  if (hasEmail && hasName) return 'email_name';
  if (hasEmail) return 'email_only';
  if (hasPhone && hasName) return 'phone_name';
  if (hasPhone) return 'phone_only';
  if (lead.address?.trim() || lead.postalCode?.trim()) return 'address_only';
  return 'incomplete';
}

/**
 * Parses contact-only CSV data. Clinical and prescription columns are ignored.
 */
export function parseLeadsCsv(csvText: string): CsvParseResult {
  const errors: string[] = [];
  const leads: Omit<ContactLead, 'id' | 'createdAt'>[] = [];
  const historicalOrders = new Map<string, LeadHistoryImportInput>();
  const sourceRecords = new Map<string, LeadSourceRecordImportInput>();

  if (!csvText || !csvText.trim()) {
    return { leads: [], historicalOrders: [], sourceRecords: [], errors: ['CSV content is empty.'], totalParsed: 0 };
  }

  let rows: string[][];
  try {
    rows = parseCsvRows(csvText);
  } catch (error) {
    return {
      leads: [],
      historicalOrders: [],
      sourceRecords: [],
      errors: [error instanceof Error ? error.message : 'CSV could not be parsed.'],
      totalParsed: 0,
    };
  }
  if (rows.length < 2) {
    return {
      leads: [],
      historicalOrders: [],
      sourceRecords: [],
      errors: ['CSV must have a header row and at least one data row.'],
      totalParsed: 0,
    };
  }
  if (rows.length > 20001) {
    return {
      leads: [],
      historicalOrders: [],
      sourceRecords: [],
      errors: ['A contact import can contain at most 20,000 rows.'],
      totalParsed: 0,
    };
  }

  const headers = rows[0].map((header) => header.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const findIdx = (names: string[]) => headers.findIndex((header) => names.includes(header));
  const fnIdx = findIdx(['first_name', 'firstname', 'first']);
  const lnIdx = findIdx(['last_name', 'lastname', 'last']);
  const emailIndexes = headers.flatMap((header, index) =>
    /(^|_)(e_?mail|mail)(_|$)/.test(header) ? [index] : []);
  const phoneIndexes = headers.flatMap((header, index) =>
    /(^|_)(phone|mobile|telephone|tel)(_|$)/.test(header) ? [index] : []);
  const countryIdx = findIdx(['country', 'country_name', 'location_country']);
  const addressIdx = findIdx(['address', 'street', 'street_address', 'delivery_address', 'shipping_address']);
  const postalCodeIdx = findIdx(['postal_code', 'postalcode', 'zip', 'zip_code', 'zipcode', 'postcode', 'postal']);
  const historyAddressIdx = findIdx(['delivery_address', 'shipping_address']);
  const consentIdx = findIdx(['marketing_consent', 'marketing_opt_in', 'consent']);
  const orderNumberIdx = findIdx(['order_number', 'order_id', 'invoice_number']);
  const orderDateIdx = findIdx(['order_date', 'placed_at', 'purchase_date']);
  const itemsIdx = findIdx(['order_items', 'items', 'product', 'products', 'product_name', 'item_description', 'order_description']);
  const trackingIdx = findIdx(['tracking_number', 'tracking', 'shipment_tracking']);
  const carrierIdx = findIdx(['carrier', 'shipping_carrier', 'delivery_carrier']);
  const sourceKeyIdx = findIdx(['source_key', 'source_record_key', 'record_key']);
  const sourceSheetIdx = findIdx(['source_sheet', 'sheet_name', 'source_tab']);
  const sourceFileIdx = findIdx(['source_file', 'workbook', 'filename']);
  const sourceRowIdx = findIdx(['source_row', 'row_number', 'source_row_number']);
  const sourceDataIdx = findIdx(['source_data', 'source_row_data', 'source_record_data']);
  if (emailIndexes.length === 0 && phoneIndexes.length === 0 && postalCodeIdx === -1 && addressIdx === -1) {
    errors.push('CSV header must contain an email, phone, postal code, or address column.');
    return { leads: [], historicalOrders: [], sourceRecords: [], errors, totalParsed: 0 };
  }

  const leadByIdentity = new Map<string, Omit<ContactLead, 'id' | 'createdAt'>>();
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const cols = rows[rowIndex];
    const firstName = (fnIdx === -1 ? '' : cols[fnIdx] || '').trim();
    const lastName = (lnIdx === -1 ? '' : cols[lnIdx] || '').trim();
    const emailValues = Array.from(new Set(emailIndexes.flatMap((index) => {
      const value = cols[index] || '';
      const matches = value.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/gi) || [];
      return matches.map((candidate) => candidate.toLowerCase()).filter(isValidLeadEmail);
    })));
    const rawPhoneValues = phoneIndexes.map((index) => (cols[index] || '').trim());
    const phoneValues = Array.from(new Set(rawPhoneValues.flatMap((value) => {
      if (!value || /^\d{5}(?:-\d{4})?$/.test(value)) return [];
      const matches = value.match(/\+?\d(?:[\d\s().-]*\d)?/g) || [];
      return matches
        .map((candidate) => candidate.trim())
        .filter((candidate) => candidate.replace(/\D/g, '').length >= 7 && !/^\d{5}(?:-\d{4})?$/.test(candidate));
    })));
    const countryInput = countryIdx !== -1 ? cols[countryIdx]?.trim() || '' : '';
    const country = getLeadCountryLabel(countryInput, phoneValues[0] || '');
    const address = addressIdx !== -1 ? cols[addressIdx]?.trim() || '' : '';
    const postalCode = (postalCodeIdx !== -1 ? cols[postalCodeIdx]?.trim() : '')
      || rawPhoneValues.find((value) => /^\d{5}(?:-\d{4})?$/.test(value))
      || '';
    const contactCandidates = emailValues.length > 0
      ? [
        ...emailValues.map((value) => ({ email: value, phone: phoneValues.length === 1 ? phoneValues[0] : '' })),
        ...(phoneValues.length > 1 ? phoneValues.map((value) => ({ email: '', phone: value })) : []),
      ]
      : phoneValues.length > 0
        ? phoneValues.map((value) => ({ email: '', phone: value }))
        : address || postalCode
          ? [{ email: '', phone: '' }]
          : [];
    if (contactCandidates.length === 0) {
      if (errors.length < 20) {
        errors.push(`Row ${rowIndex + 1}: Skipped row due to missing valid email, phone, or address.`);
      }
      continue;
    }
    const consentValue = consentIdx === -1 ? '' : (cols[consentIdx] || '').toLowerCase();

    for (const { email, phone } of contactCandidates) {
      const hasPhone = phone.replace(/\D/g, '').length >= 7;
      const lead: Omit<ContactLead, 'id' | 'createdAt'> = {
        firstName,
        lastName,
        leadSource: 'CSV Upload',
        email,
        phone,
        country: country !== 'Not specified' ? country : getLeadCountry(phone),
        address: address || undefined,
        postalCode: postalCode || undefined,
        status: 'Cold',
        marketingConsent: ['yes', 'true', '1', 'opted in'].includes(consentValue),
      };
      const identity = email
        ? `email:${email}`
        : hasPhone
          ? `phone:${phone.replace(/\D/g, '')}:${firstName.toLowerCase()}:${lastName.toLowerCase()}`
          : `address:${firstName.toLowerCase()}:${lastName.toLowerCase()}:${(address || postalCode).toLowerCase()}`;
      const existing = leadByIdentity.get(identity);
      if (!existing) {
        leadByIdentity.set(identity, lead);
      } else {
        leadByIdentity.set(identity, {
          ...existing,
          firstName: existing.firstName || lead.firstName,
          lastName: existing.lastName || lead.lastName,
          phone: existing.phone || lead.phone,
          country: existing.country || lead.country,
          address: existing.address || lead.address,
          postalCode: existing.postalCode || lead.postalCode,
          marketingConsent: existing.marketingConsent || lead.marketingConsent,
        });
      }
    }

    const primaryContact = contactCandidates[0];
    const email = primaryContact.email;
    const phone = primaryContact.phone;
    const orderNumber = orderNumberIdx === -1 ? '' : (cols[orderNumberIdx] || '').trim();
    const placedAt = orderDateIdx === -1 ? '' : (cols[orderDateIdx] || '').trim();
    const items = itemsIdx === -1 ? '' : (cols[itemsIdx] || '').trim();
    const trackingNumber = trackingIdx === -1 ? '' : (cols[trackingIdx] || '').trim();
    const carrier = carrierIdx === -1 ? '' : (cols[carrierIdx] || '').trim();
    const deliveryAddress = historyAddressIdx === -1
      ? address
      : (cols[historyAddressIdx] || '').trim() || address;
    if (orderNumber || placedAt || items || trackingNumber) {
      const sourceKey = sourceKeyIdx === -1 ? '' : (cols[sourceKeyIdx] || '').trim();
      const sourceSheet = sourceSheetIdx === -1 ? '' : (cols[sourceSheetIdx] || '').trim();
      const identityKey = sourceKey || [
        email,
        phone.replace(/\D/g, ''),
        orderNumber.toLowerCase(),
        placedAt,
        items.toLowerCase(),
        trackingNumber.toLowerCase(),
      ].join('|');
      historicalOrders.set(identityKey, {
        firstName,
        lastName,
        email,
        phone,
        postalCode,
        orderNumber,
        placedAt,
        items,
        trackingNumber,
        carrier,
        deliveryAddress,
        sourceKey,
        sourceSheet,
      });
    }

    const rawSourceData = sourceDataIdx === -1 ? '' : (cols[sourceDataIdx] || '').trim();
    if (rawSourceData) {
      try {
        const parsed = JSON.parse(rawSourceData) as unknown;
        const sourceKey = sourceKeyIdx === -1 ? '' : (cols[sourceKeyIdx] || '').trim();
        const sourceRow = Number(sourceRowIdx === -1 ? '' : cols[sourceRowIdx]);
        const sourceFile = sourceFileIdx === -1 ? '' : (cols[sourceFileIdx] || '').trim();
        const sourceSheet = sourceSheetIdx === -1 ? '' : (cols[sourceSheetIdx] || '').trim();
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
          || !sourceKey || !sourceFile || !sourceSheet || !Number.isSafeInteger(sourceRow) || sourceRow < 1) {
          throw new Error('Source row details or provenance are invalid.');
        }
        const data = Object.fromEntries(
          Object.entries(parsed).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string'
            && !/(?:payment|credit|debit|card|(?:^|[^a-z])cc(?:[^a-z]|$)|cvv|cvc|ccv|security.?code|expir(?:y|ation)|medical|medication|prescription|diagnos|symptom|patient)/i.test(entry[0])
            && !containsPossiblePaymentCardNumber(entry[1], entry[0]),
          ),
        );
        for (const contact of contactCandidates) {
          const identity = contact.email || contact.phone.replace(/\D/g, '') || address || postalCode;
          sourceRecords.set(`${sourceKey}:${identity}`, {
            firstName,
            lastName,
            email: contact.email,
            phone: contact.phone,
            address,
            postalCode,
            sourceFile,
            sourceSheet,
            sourceRow,
            sourceKey,
            data,
          });
        }
      } catch {
        if (errors.length < 20) errors.push(`Row ${rowIndex + 1}: Source row details or provenance are invalid.`);
      }
    }
  }

  return {
    leads: Array.from(leadByIdentity.values()),
    historicalOrders: Array.from(historicalOrders.values()),
    sourceRecords: Array.from(sourceRecords.values()),
    errors,
    totalParsed: leadByIdentity.size,
  };
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
  currentDateStr = getLocalDateString()
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
