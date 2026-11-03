export type HealthCategory =
  | 'Sleep'
  | 'Weight Loss'
  | 'Energy & Focus'
  | 'Cardiology / Hypertension'
  | 'Diabetes Care'
  | 'Asthma & Respiratory'
  | 'Digestive Health'
  | 'Daily Wellness'
  | 'General Care';

export type RefillStatus = 'Active' | 'Due Soon' | 'Renewal Required' | 'Overdue' | 'Completed';

export interface RefillRecord {
  id: string;
  rxNumber: string;
  medicationName: string;
  strength: string;
  dosageForm: string; // e.g. "Oral Tablet", "Inhaler", "Subcutaneous Pen"
  quantity: number;
  daysSupply: number;
  providerDoctor: string;
  doctorClinic: string;
  dateFilled: string;
  nextRefillDue: string;
  remainingRefills: number;
  status: RefillStatus;
  refillInstructions: string;
}

export interface PharmacistNote {
  id: string;
  patientId: string;
  authorName: string;
  authorTitle: string; // e.g. "PharmD, Clinical Specialist"
  noteType: 'Clinical Evaluation' | 'Drug Interaction Alert' | 'Dosage Modification' | 'Patient Consultation' | 'Refill Authorization';
  content: string;
  drugAlertLevel: 'None' | 'Advisory' | 'Severe Warning';
  isConfidential: boolean;
  createdAt: string;
}

export interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  address: string;
  insuranceProvider: string;
  insurancePolicyNumber: string;
  healthCategory: HealthCategory;
  primaryDoctor: string;
  allergies: string[];
  activeMedicationsCount: number;
  nextRenewalDate: string;
  leadSource: 'Manual Entry' | 'CSV Upload' | 'Online Order' | 'Treatment Transfer';
  createdAt: string;
  refillHistory: RefillRecord[];
  notes: PharmacistNote[];
}

export interface ContactLead {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  leadSource: 'Manual Entry' | 'CSV Upload' | 'Online Order' | 'Synthetic Demo';
  createdAt: string;
  status: LeadStatus;
  marketingConsent: boolean;
  marketingConsentAt?: string | null;
  orderCount?: number;
  lastOrderAt?: string | null;
}

export type ContactLeadInput = Pick<
  ContactLead,
  'firstName' | 'lastName' | 'email' | 'phone' | 'leadSource' | 'status' | 'marketingConsent'
>;

export type LeadStatus = 'Cold' | 'Contacted' | 'Qualified' | 'Customer' | 'Inactive';

export interface LeadProfile {
  lead: ContactLead;
  orders: OnlineOrder[];
}

export type PaymentMethod =
  | 'Credit / Debit Card'
  | 'PayPal'
  | 'Cryptocurrency (USDC / BTC / ETH / SOL)'
  | 'Cash on Delivery / Pickup';

export type PaymentStatus = 'Paid' | 'Pending Verification' | 'Refunded';

export interface OrderItem {
  productId: string;
  name: string;
  category: StoreCategory;
  quantity: number;
  unitPrice: number;
  image?: string;
  dosage?: string;
  rxRequired?: boolean;
}

export interface CryptoPaymentDetails {
  currency: 'USDC' | 'BTC' | 'ETH' | 'SOL';
  amountCrypto: string;
  walletAddress: string;
  txHash?: string;
  network: string;
}

export interface OnlineOrder {
  id: string;
  orderNumber: string;
  patientName: string;
  email: string;
  phone: string;
  rxNumber?: string;
  medicationName: string;
  items?: OrderItem[];
  subtotal?: number;
  shippingFee?: number;
  discountAmount?: number;
  couponCode?: string;
  orderType: 'Medication Refill' | 'OTC Purchase' | 'New Order Transfer' | 'Store Purchase';
  deliveryMethod: 'Express Courier' | 'Pharmacy Pickup' | 'Discreet Mail';
  deliveryAddress?: string;
  paymentMethod?: PaymentMethod;
  paymentStatus?: PaymentStatus;
  transactionId?: string;
  cryptoDetails?: CryptoPaymentDetails;
  cardLast4?: string;
  totalAmount: number;
  status: 'Submitted' | 'Pharmacist Review' | 'Dispensing' | 'Ready for Pickup' | 'Shipped' | 'Completed' | 'Cancelled';
  placedAt: string;
  carrier?: string;
  trackingNumber?: string;
  notes?: string;
  internalNotes?: string[];
}

export interface HostingerConfig {
  emailAccount: string;
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
  useSsl: boolean;
  isConnected: boolean;
  autoSyncDatabase: boolean;
  lastSyncedAt: string;
  displayName: string;
}

export interface EmailLog {
  id: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  body: string;
  status: 'Draft' | 'Queued' | 'Sent' | 'Delivered' | 'Opened' | 'Replied' | 'Failed';
  sentAt: string;
  emailType: 'automated_renewal' | 'direct_message' | 'bulk_campaign' | 'order_confirmation';
  healthCategory?: HealthCategory;
  rxNumber?: string;
  openedAt?: string;
  repliedAt?: string;
  replyBody?: string;
}

export interface ReminderRule {
  id: string;
  daysBeforeDue: number;
  title: string;
  subjectTemplate: string;
  bodyTemplate: string;
  isActive: boolean;
}

export type StoreCategory = string;

export interface CatalogItem {
  id: string;
  name: string;
  category: StoreCategory;
  price: number;
  costPrice?: number;
  copayPrice?: number;
  description: string;
  rxRequired: boolean; // Clinical authorization required
  dosage: string;
  inStock: boolean;
  stockCount: number;
  minStockThreshold: number;
  sku: string;
  ndcCode?: string;
  image?: string;
  lastRestocked?: string;
}

export interface CartItem {
  item: CatalogItem;
  quantity: number;
  itemCode?: string;
}

export interface BulkCampaign {
  id: string;
  title: string;
  targetCategory: HealthCategory | 'All Patients';
  subject: string;
  messageTemplate: string;
  recipientCount: number;
  status: 'Draft' | 'Sent';
  sentAt?: string;
}
