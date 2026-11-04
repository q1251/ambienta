import express, { Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(cookieParser());

// --- IN-MEMORY DATA STORES ---

interface StoredProduct {
  id: string;
  name: string;
  category: string;
  price: number;
  costPrice: number;
  copayPrice: number;
  description: string;
  rxRequired: boolean;
  dosage: string;
  inStock: boolean;
  stockCount: number;
  minStockThreshold: number;
  sku: string;
  image?: string;
  images?: string[];
  lastRestocked?: string;
  ndcCode?: string;
  isActive?: boolean;
  isFeatured?: boolean;
}

const CATEGORIES = [
  'Sleep',
  'Weight Loss',
  'Energy & Focus',
  'Heart & Circulation',
  'Digestive Health',
  'Daily Wellness',
  'Pain & Recovery',
];

const INITIAL_PRODUCTS: StoredProduct[] = [
  {
    id: 'cat-sleep-1',
    name: 'Deep Sleep Botanical Night Calm Formula',
    category: 'Sleep',
    price: 24.0,
    costPrice: 9.5,
    copayPrice: 0.0,
    description: 'Apothecary grade blend of Chamomile, Passionflower, Magnesium Glycinate, and bio-available Melatonin for deep restorative sleep cycles.',
    rxRequired: false,
    dosage: '60 Herbal Capsules / 250mg',
    inStock: true,
    stockCount: 180,
    minStockThreshold: 25,
    sku: 'SLP-CALM-060',
    lastRestocked: '2026-10-30',
    isActive: true,
  },
  {
    id: 'cat-sleep-2',
    name: 'Magnesium L-Threonate Neuro Rest',
    category: 'Sleep',
    price: 32.0,
    costPrice: 14.0,
    copayPrice: 0.0,
    description: 'Advanced brain-permeable magnesium form that calms neurotransmitters, eases nocturnal restlessness, and supports vivid sleep recovery.',
    rxRequired: false,
    dosage: '500 mg / 90 Vegetarian Capsules',
    inStock: true,
    stockCount: 95,
    minStockThreshold: 20,
    sku: 'SLP-MAG-500',
    lastRestocked: '2026-10-25',
    isActive: true,
  },
  {
    id: 'cat-sleep-3',
    name: 'Valerian Root & L-Theanine Night Tincture',
    category: 'Sleep',
    price: 21.5,
    costPrice: 8.0,
    copayPrice: 0.0,
    description: 'Fast-absorbing botanical sublingual drops designed to quiet racing bedtime thoughts and promote rapid sleep onset without grogginess.',
    rxRequired: false,
    dosage: '30 ml Amber Dropper Bottle',
    inStock: true,
    stockCount: 64,
    minStockThreshold: 15,
    sku: 'SLP-VAL-030M',
    lastRestocked: '2026-10-28',
    isActive: true,
  },
  {
    id: 'cat-wl-1',
    name: 'Metabolic Vitality Clean Thermogenic Support',
    category: 'Weight Loss',
    price: 38.0,
    costPrice: 15.5,
    copayPrice: 0.0,
    description: 'Clinical grade metabolic catalyst combining standardized Berberine phytosome, EGCG green tea extract, and chromium for healthy weight management.',
    rxRequired: false,
    dosage: '60 Vegan Capsules',
    inStock: true,
    stockCount: 140,
    minStockThreshold: 30,
    sku: 'WGT-MET-060V',
    lastRestocked: '2026-10-29',
    isActive: true,
  },
  {
    id: 'cat-wl-2',
    name: 'Semaglutide Clinical Metabolic Kit',
    category: 'Weight Loss',
    price: 149.0,
    costPrice: 95.0,
    copayPrice: 25.0,
    description: 'GLP-1 receptor agonist support therapy for appetite regulation and metabolic glucose balance. Clinical team reviews verification prior to dispensing.',
    rxRequired: true,
    dosage: '0.5 mg Subcutaneous Pen Injector',
    inStock: true,
    stockCount: 45,
    minStockThreshold: 10,
    sku: 'WGT-GLP-005',
    ndcCode: 'NDC 0169-4132-12',
    lastRestocked: '2026-10-20',
    isActive: true,
  },
  {
    id: 'cat-wl-3',
    name: 'Appetite Control Organic Glucomannan Fiber',
    category: 'Weight Loss',
    price: 24.5,
    costPrice: 9.0,
    copayPrice: 0.0,
    description: 'Pure soluble konjac fiber that expands gently in the stomach to promote prolonged fullness, stabilize post-meal glucose, and aid natural weight goals.',
    rxRequired: false,
    dosage: '180 Capsules / 600mg',
    inStock: true,
    stockCount: 88,
    minStockThreshold: 15,
    sku: 'WGT-GLC-180',
    lastRestocked: '2026-10-18',
    isActive: true,
  },
  {
    id: 'cat-ef-1',
    name: 'High Potency Active Methyl B-Complex',
    category: 'Energy & Focus',
    price: 22.0,
    costPrice: 8.5,
    copayPrice: 0.0,
    description: 'Methylated folate (5-MTHF) and active B12 methylcobalamin to support mitochondrial energy production and eliminate afternoon brain fog.',
    rxRequired: false,
    dosage: '60 Vegetable Capsules',
    inStock: true,
    stockCount: 110,
    minStockThreshold: 20,
    sku: 'NRG-BCOMP-60',
    lastRestocked: '2026-10-15',
    isActive: true,
  },
  {
    id: 'cat-ef-2',
    name: 'CoQ10 Ubiquinol 200mg Cellular Vitality',
    category: 'Energy & Focus',
    price: 39.0,
    costPrice: 19.0,
    copayPrice: 0.0,
    description: 'Active antioxidant form of Coenzyme Q10 for superior bioavailability, cardiac muscle energy, and combating statin-related muscular fatigue.',
    rxRequired: false,
    dosage: '60 Softgels / 200mg',
    inStock: true,
    stockCount: 72,
    minStockThreshold: 15,
    sku: 'NRG-UBQ-200',
    lastRestocked: '2026-10-22',
    isActive: true,
  },
  {
    id: 'cat-hrt-1',
    name: 'Lisinopril Cardiovascular Care 20mg',
    category: 'Heart & Circulation',
    price: 12.0,
    costPrice: 3.5,
    copayPrice: 4.0,
    description: 'Arterial blood pressure regulation and endothelial protection. Verified by on-duty clinical team prior to dispatch.',
    rxRequired: true,
    dosage: '20 mg Oral Tablets, 30 Count',
    inStock: true,
    stockCount: 95,
    minStockThreshold: 25,
    sku: 'HRT-LIS-020',
    ndcCode: 'NDC 68180-514-01',
    lastRestocked: '2026-10-22',
    isActive: true,
  },
  {
    id: 'cat-hrt-2',
    name: 'Clinical Grade Omega-3 EPA/DHA Pure Triglyceride',
    category: 'Heart & Circulation',
    price: 34.0,
    costPrice: 18.5,
    copayPrice: 0.0,
    description: 'Molecularly distilled high-purity fish oil providing 800mg EPA and 400mg DHA to support arterial flexibility and healthy lipid ratios.',
    rxRequired: false,
    dosage: '1200 mg / 60 Softgels',
    inStock: true,
    stockCount: 68,
    minStockThreshold: 20,
    sku: 'HRT-OMG-1200',
    lastRestocked: '2026-10-15',
    isActive: true,
  },
  {
    id: 'cat-dig-1',
    name: 'Probiotic Ultra 50 Billion CFU Gut Defense',
    category: 'Digestive Health',
    price: 36.0,
    costPrice: 16.0,
    copayPrice: 0.0,
    description: '14 clinically researched probiotic strains with prebiotic FOS in acid-resistant DRcaps for microbiome balance and digestive comfort.',
    rxRequired: false,
    dosage: '60 Delayed-Release Capsules',
    inStock: true,
    stockCount: 82,
    minStockThreshold: 20,
    sku: 'DIG-PRO-050B',
    lastRestocked: '2026-10-24',
    isActive: true,
  },
  {
    id: 'cat-dig-2',
    name: 'Omeprazole Delayed Release 20mg',
    category: 'Digestive Health',
    price: 18.0,
    costPrice: 6.5,
    copayPrice: 5.0,
    description: 'Proton pump inhibitor for frequent heartburn and gastroesophageal acid management.',
    rxRequired: false,
    dosage: '42 Tablets (Three 14-Day Courses)',
    inStock: true,
    stockCount: 50,
    minStockThreshold: 15,
    sku: 'DIG-OMP-020',
    ndcCode: 'NDC 68382-012-42',
    lastRestocked: '2026-10-19',
    isActive: true,
  },
  {
    id: 'cat-wel-1',
    name: 'Liposomal Vitamin C 1000mg Immune Shield',
    category: 'Daily Wellness',
    price: 24.0,
    costPrice: 10.0,
    copayPrice: 0.0,
    description: 'Phospholipid bilayer encapsulation for exceptional cellular bioavailability and stomach-friendly all-day antioxidant defense.',
    rxRequired: false,
    dosage: '60 Liquid Softgels',
    inStock: true,
    stockCount: 115,
    minStockThreshold: 25,
    sku: 'WEL-LPC-1000',
    lastRestocked: '2026-10-26',
    isActive: true,
  },
  {
    id: 'cat-wel-2',
    name: 'Vitamin D3 + K2 (MK-7) Synergy Drops',
    category: 'Daily Wellness',
    price: 19.5,
    costPrice: 7.2,
    copayPrice: 0.0,
    description: '5,000 IU cholecalciferol blended with MenaQ7 Vitamin K2 in organic MCT oil for calcium absorption and bone density.',
    rxRequired: false,
    dosage: '30 ml Glass Dropper Bottle',
    inStock: true,
    stockCount: 77,
    minStockThreshold: 15,
    sku: 'WEL-D3K2-030',
    lastRestocked: '2026-10-21',
    isActive: true,
  },
  {
    id: 'cat-pain-1',
    name: 'Curcumin C3 Complex Anti-Inflammatory 500mg',
    category: 'Pain & Recovery',
    price: 31.0,
    costPrice: 13.5,
    copayPrice: 0.0,
    description: 'Standardized 95% curcuminoids paired with BioPerine black pepper extract for joint mobility and post-exercise muscle comfort.',
    rxRequired: false,
    dosage: '60 High-Absorption Capsules',
    inStock: true,
    stockCount: 65,
    minStockThreshold: 15,
    sku: 'REC-CUR-500',
    lastRestocked: '2026-10-17',
    isActive: true,
  },
  {
    id: 'cat-pain-2',
    name: 'Arnica & Menthol Botanical Cooling Muscle Rub',
    category: 'Pain & Recovery',
    price: 17.5,
    costPrice: 6.8,
    copayPrice: 0.0,
    description: 'Targeted topical relief gel with therapeutic camphor, eucalyptus, and organic Montana arnica extract for sore joints and strains.',
    rxRequired: false,
    dosage: '100 ml Pump Tube',
    inStock: true,
    stockCount: 48,
    minStockThreshold: 12,
    sku: 'REC-ARN-100',
    lastRestocked: '2026-10-23',
    isActive: true,
  },
];

let productsStore = [...INITIAL_PRODUCTS];
let categoriesStore = [...CATEGORIES];

interface StoredOrder {
  id: string;
  orderNumber: string;
  patientName: string;
  email: string;
  phone: string;
  rxNumber?: string;
  medicationName?: string;
  items: Array<{
    productId: string;
    name: string;
    category: string;
    quantity: number;
    unitPrice: number;
    dosage?: string;
    rxRequired?: boolean;
    image?: string;
  }>;
  subtotal: number;
  shippingFee: number;
  discountAmount: number;
  couponCode?: string;
  totalAmount: number;
  orderType: string;
  deliveryMethod: 'Standard Home Delivery' | 'Express Courier' | 'Pharmacy Curbside Pickup';
  deliveryAddress: string;
  paymentMethod: string;
  paymentStatus: 'Pending' | 'Paid' | 'Failed' | 'Refunded';
  cardLast4?: string;
  transactionId?: string;
  status: 'Pending' | 'Submitted' | 'Pharmacist Review' | 'Dispensing' | 'Shipped' | 'Ready for Pickup' | 'Delivered' | 'Cancelled';
  placedAt: string;
  carrier?: string;
  trackingNumber?: string;
  notes?: string;
  internalNotes?: string[];
}

const INITIAL_ORDERS: StoredOrder[] = [
  {
    id: 'ord-901',
    orderNumber: 'ORD-20261102-108',
    patientName: 'Eleanor Vance',
    email: 'eleanor.vance@wellnessmail.com',
    phone: '+1 (555) 349-1102',
    rxNumber: 'RX-884219',
    medicationName: 'Metformin Hydrochloride ER + Deep Sleep Formula',
    items: [
      {
        productId: 'cat-sleep-1',
        name: 'Deep Sleep Botanical Night Calm Formula',
        category: 'Sleep',
        quantity: 2,
        unitPrice: 24.0,
        dosage: '60 Herbal Capsules / 250mg',
        rxRequired: false,
      },
      {
        productId: 'cat-wel-1',
        name: 'Liposomal Vitamin C 1000mg Immune Shield',
        category: 'Daily Wellness',
        quantity: 1,
        unitPrice: 24.0,
        dosage: '60 Liquid Softgels',
        rxRequired: false,
      },
    ],
    subtotal: 72.0,
    shippingFee: 12.0,
    discountAmount: 7.2,
    couponCode: 'AURA10',
    totalAmount: 76.8,
    orderType: 'Store Purchase',
    deliveryMethod: 'Express Courier',
    deliveryAddress: '428 Elmwood Terrace, Suite 3B, Springfield, IL 62704',
    paymentMethod: 'Credit / Debit Card',
    paymentStatus: 'Paid',
    cardLast4: '4242',
    transactionId: 'ch_3Ox9219AuraCardPay',
    status: 'Dispensing',
    placedAt: '2026-11-02 03:45 AM',
    carrier: 'CareCourier Express',
    trackingNumber: 'CCE-88204-IL',
    notes: 'Please leave package at front door with discreet label.',
    internalNotes: [
      'Card payment settled via Stripe Connect gateway',
      'Discreet temperature seal applied at packaging station #2',
    ],
  },
  {
    id: 'ord-902',
    orderNumber: 'ORD-20261102-107',
    patientName: 'Chloe Sorenson',
    email: 'chloe.sorenson@northshore.com',
    phone: '+1 (555) 918-2041',
    medicationName: 'Semaglutide Clinical Kit + Thermogenic Support',
    items: [
      {
        productId: 'cat-wl-2',
        name: 'Semaglutide Clinical Metabolic Kit',
        category: 'Weight Loss',
        quantity: 1,
        unitPrice: 149.0,
        dosage: '0.5 mg Subcutaneous Pen Injector',
        rxRequired: true,
      },
      {
        productId: 'cat-wl-1',
        name: 'Metabolic Vitality Clean Thermogenic Support',
        category: 'Weight Loss',
        quantity: 1,
        unitPrice: 38.0,
        dosage: '60 Vegan Capsules',
        rxRequired: false,
      },
    ],
    subtotal: 187.0,
    shippingFee: 0.0,
    discountAmount: 0.0,
    totalAmount: 187.0,
    orderType: 'Store Purchase',
    deliveryMethod: 'Standard Home Delivery',
    deliveryAddress: '7442 North Shore Boulevard, Evanston, IL 60201',
    paymentMethod: 'Credit / Debit Card',
    paymentStatus: 'Paid',
    cardLast4: '8831',
    transactionId: 'ch_89Pq712NorthShore',
    status: 'Pharmacist Review',
    placedAt: '2026-11-02 01:15 AM',
    notes: 'Please verify GLP-1 clinic prescription protocol on file.',
    internalNotes: ['Prior auth verified through CoverMyMeds portal.'],
  },
  {
    id: 'ord-903',
    orderNumber: 'ORD-20261101-104',
    patientName: 'Marcus Bennett',
    email: 'm.bennett@midwestlogistics.com',
    phone: '+1 (555) 438-7109',
    medicationName: 'Lisinopril Cardiovascular Care 20mg',
    items: [
      {
        productId: 'cat-hrt-1',
        name: 'Lisinopril Cardiovascular Care 20mg',
        category: 'Heart & Circulation',
        quantity: 1,
        unitPrice: 12.0,
        dosage: '20 mg Oral Tablets, 30 Count',
        rxRequired: true,
      },
      {
        productId: 'cat-hrt-2',
        name: 'Clinical Grade Omega-3 EPA/DHA Pure Triglyceride',
        category: 'Heart & Circulation',
        quantity: 1,
        unitPrice: 34.0,
        dosage: '1200 mg / 60 Softgels',
        rxRequired: false,
      },
    ],
    subtotal: 46.0,
    shippingFee: 0.0,
    discountAmount: 0.0,
    totalAmount: 46.0,
    orderType: 'Store Purchase',
    deliveryMethod: 'Pharmacy Curbside Pickup',
    deliveryAddress: 'Curbside Spot #3, AuraCare Main Dispensary',
    paymentMethod: 'Cash on Delivery / Pickup',
    paymentStatus: 'Paid',
    status: 'Delivered',
    placedAt: '2026-11-01 10:20 AM',
    carrier: 'Store Pickup',
    trackingNumber: 'PICKUP-ORD-903',
    internalNotes: ['Patient verified identity at curbside.'],
  },
];

let ordersStore = [...INITIAL_ORDERS];

interface StoredLead {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: string;
  leadSource: 'Manual Entry' | 'CSV Upload' | 'Online Order' | 'Synthetic Demo' | 'Live chat';
  createdAt: string;
  status: 'New' | 'Cold' | 'Contacted' | 'Qualified' | 'Customer' | 'Inactive';
  marketingConsent: boolean;
  marketingConsentAt: string | null;
  orderCount: number;
  lastOrderAt: string | null;
  activeOrderCount: number;
  callCount: number;
  assignedStaffId: number | null;
  assignedStaffName: string | null;
}

const INITIAL_LEADS: StoredLead[] = [
  {
    id: 1,
    firstName: 'Eleanor',
    lastName: 'Vance',
    email: 'eleanor.vance@wellnessmail.com',
    phone: '+1 (555) 349-1102',
    country: 'United States',
    leadSource: 'Online Order',
    createdAt: '2026-10-15T09:30:00Z',
    status: 'Customer',
    marketingConsent: true,
    marketingConsentAt: '2026-10-15T09:30:00Z',
    orderCount: 2,
    lastOrderAt: '2026-11-02 03:45 AM',
    activeOrderCount: 1,
    callCount: 1,
    assignedStaffId: 1,
    assignedStaffName: 'Sarah Jenkins, PharmD',
  },
  {
    id: 2,
    firstName: 'Chloe',
    lastName: 'Sorenson',
    email: 'chloe.sorenson@northshore.com',
    phone: '+1 (555) 918-2041',
    country: 'United States',
    leadSource: 'Online Order',
    createdAt: '2026-10-20T14:10:00Z',
    status: 'Customer',
    marketingConsent: true,
    marketingConsentAt: '2026-10-20T14:10:00Z',
    orderCount: 1,
    lastOrderAt: '2026-11-02 01:15 AM',
    activeOrderCount: 1,
    callCount: 0,
    assignedStaffId: 1,
    assignedStaffName: 'Sarah Jenkins, PharmD',
  },
  {
    id: 3,
    firstName: 'Marcus',
    lastName: 'Bennett',
    email: 'm.bennett@midwestlogistics.com',
    phone: '+1 (555) 438-7109',
    country: 'United States',
    leadSource: 'Online Order',
    createdAt: '2026-10-22T11:00:00Z',
    status: 'Customer',
    marketingConsent: false,
    marketingConsentAt: null,
    orderCount: 1,
    lastOrderAt: '2026-11-01 10:20 AM',
    activeOrderCount: 0,
    callCount: 1,
    assignedStaffId: null,
    assignedStaffName: null,
  },
  {
    id: 4,
    firstName: 'Julian',
    lastName: 'Crestwood',
    email: 'j.crestwood@lakeviewtech.io',
    phone: '+1 (555) 802-9934',
    country: 'United States',
    leadSource: 'Manual Entry',
    createdAt: '2026-10-24T16:45:00Z',
    status: 'Qualified',
    marketingConsent: true,
    marketingConsentAt: '2026-10-24T16:45:00Z',
    orderCount: 0,
    lastOrderAt: null,
    activeOrderCount: 0,
    callCount: 2,
    assignedStaffId: 1,
    assignedStaffName: 'Sarah Jenkins, PharmD',
  },
  {
    id: 5,
    firstName: 'Sophia',
    lastName: 'Kovacs',
    email: 'sophia.kovacs@bioresearch.org',
    phone: '+1 (555) 234-8871',
    country: 'Canada',
    leadSource: 'Live chat',
    createdAt: '2026-10-28T12:00:00Z',
    status: 'Contacted',
    marketingConsent: true,
    marketingConsentAt: '2026-10-28T12:00:00Z',
    orderCount: 0,
    lastOrderAt: null,
    activeOrderCount: 0,
    callCount: 1,
    assignedStaffId: null,
    assignedStaffName: null,
  },
  {
    id: 6,
    firstName: 'David',
    lastName: 'Miller',
    email: 'david.miller@example.com',
    phone: '+1 (555) 781-9920',
    country: 'United States',
    leadSource: 'Synthetic Demo',
    createdAt: '2026-10-29T10:00:00Z',
    status: 'Cold',
    marketingConsent: false,
    marketingConsentAt: null,
    orderCount: 0,
    lastOrderAt: null,
    activeOrderCount: 0,
    callCount: 0,
    assignedStaffId: null,
    assignedStaffName: null,
  },
];

let leadsStore = [...INITIAL_LEADS];
let leadIdCounter = 100;

interface StoredActivity {
  id: number;
  leadId: number;
  activityType: string;
  note: string;
  callOutcome?: string;
  followUpDate?: string;
  authorEmail: string;
  authorName: string;
  createdAt: string;
}

let activitiesStore: StoredActivity[] = [
  {
    id: 1,
    leadId: 1,
    activityType: 'Call',
    note: 'Followed up on Metformin titration. Patient reports stable tolerability with meals.',
    callOutcome: 'Connected',
    authorEmail: 'afosterofficial@gmail.com',
    authorName: 'Administrator',
    createdAt: '2026-11-01T14:30:00Z',
  },
  {
    id: 2,
    leadId: 4,
    activityType: 'Call',
    note: 'Consulted regarding cardiac wellness bundle and omega-3 supplements.',
    callOutcome: 'Callback requested',
    followUpDate: '2026-11-08',
    authorEmail: 'operator@ambients.com',
    authorName: 'Sarah Jenkins, PharmD',
    createdAt: '2026-11-03T10:15:00Z',
  },
];

interface StaffUser {
  id: number;
  email: string;
  display_name: string;
  role: 'operator';
  permissions: string[];
  is_active: boolean;
  created_by: string;
  created_at: string;
  assigned_lead_count: number;
}

let staffStore: StaffUser[] = [
  {
    id: 1,
    email: 'operator@ambients.com',
    display_name: 'Sarah Jenkins, PharmD',
    role: 'operator',
    permissions: ['leads', 'new_leads', 'orders', 'products', 'integrations', 'chat'],
    is_active: true,
    created_by: 'afosterofficial@gmail.com',
    created_at: '2026-10-01T08:00:00Z',
    assigned_lead_count: 3,
  },
];

let adminProfile = {
  email: 'afosterofficial@gmail.com',
  displayName: 'Administrator',
  passwordHash: 'seeded',
};

let auditLogs: Array<{
  id: number;
  actor_email: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: unknown;
  created_at: string;
}> = [
  {
    id: 1,
    actor_email: 'afosterofficial@gmail.com',
    action: 'SYSTEM_BOOT',
    entity_type: 'system',
    entity_id: 'ambients-core',
    details: { environment: 'AI Studio Node.js 22 Runtime' },
    created_at: '2026-11-04 09:00:00',
  },
  {
    id: 2,
    actor_email: 'afosterofficial@gmail.com',
    action: 'CATALOG_INITIALIZED',
    entity_type: 'catalog',
    entity_id: 'all',
    details: { count: INITIAL_PRODUCTS.length },
    created_at: '2026-11-04 09:00:01',
  },
];

// Routing settings
let crmRoutingSettings = {
  agentsMayClaimWhenAdminOnline: true,
};

import crypto from 'crypto';

// Chat state
interface ChatConversation {
  id: number;
  visitorName: string;
  visitorEmail: string;
  visitorPhone: string;
  status: 'open' | 'closed';
  createdAt: string;
  updatedAt: string;
  lastMessage: string | null;
  lastSender: 'visitor' | 'staff' | 'system' | null;
  unreadCount: number;
  ownerType: 'queue' | 'admin' | 'agent';
  ownerStaffId: number | null;
  ownerName: string;
  canClaim: boolean;
}

interface ChatMessage {
  id: number;
  conversationId: number;
  sender: 'visitor' | 'staff' | 'system';
  senderName: string;
  body: string;
  createdAt: string;
}

interface VisitorSession {
  id: string;
  visitorId: string;
  currentPath: string;
  referrerDomain: string;
  countryCode: string | null;
  language: string;
  firstSeen: string;
  lastSeen: string;
  active: boolean;
  pageCount: number;
  durationSeconds: number;
  currentTitle: string;
  currentProduct: string | null;
  chatId: number | null;
  chatStatus: 'open' | 'closed' | null;
  chatOwner: string | null;
  chatEngaged: boolean;
}

let conversationsStore: ChatConversation[] = [
  {
    id: 1,
    visitorName: 'Sophia Kovacs',
    visitorEmail: 'sophia.kovacs@bioresearch.org',
    visitorPhone: '+1 (555) 234-8871',
    status: 'open',
    createdAt: '2026-11-03T16:00:00Z',
    updatedAt: '2026-11-03T16:15:00Z',
    lastMessage: 'Hi Sophia! Our Liposomal Vitamin C is formulated exclusively with non-GMO sunflower phosphatidylcholine, completely soy-free.',
    lastSender: 'staff',
    unreadCount: 0,
    ownerType: 'agent',
    ownerStaffId: 1,
    ownerName: 'Sarah Jenkins, PharmD',
    canClaim: true,
  },
];

let chatMessagesStore: ChatMessage[] = [
  {
    id: 1,
    conversationId: 1,
    sender: 'visitor',
    senderName: 'Sophia Kovacs',
    body: 'Hello! Does the Liposomal Vitamin C formula use sunflower or soy lecithin?',
    createdAt: '2026-11-03T16:00:00Z',
  },
  {
    id: 2,
    conversationId: 1,
    sender: 'staff',
    senderName: 'Sarah Jenkins, PharmD',
    body: 'Hi Sophia! Our Liposomal Vitamin C is formulated exclusively with non-GMO sunflower phosphatidylcholine, completely soy-free.',
    createdAt: '2026-11-03T16:15:00Z',
  },
];

let visitorSessionsStore: VisitorSession[] = [
  {
    id: 'sess-vis-1',
    visitorId: 'vis-88210',
    currentPath: '/products/cat-sleep-1',
    referrerDomain: 'google.com',
    countryCode: 'US',
    language: 'en-US',
    firstSeen: '2026-11-04T17:30:00Z',
    lastSeen: '2026-11-04T18:00:00Z',
    active: true,
    pageCount: 4,
    durationSeconds: 1800,
    currentTitle: 'Deep Sleep Botanical Night Calm Formula - Ambients',
    currentProduct: 'Deep Sleep Botanical Night Calm Formula',
    chatId: 1,
    chatStatus: 'open',
    chatOwner: 'Sarah Jenkins, PharmD',
    chatEngaged: true,
  },
];

// Session auth tracking
interface UserSession {
  email: string;
  displayName: string;
  role: 'admin' | 'operator';
  permissions: string[];
  mustChangePassword: boolean;
  impersonating?: boolean;
  impersonatedBy?: string;
}

const activeSessions = new Map<string, UserSession>();

// Helper to get or build session from cookie
const getSession = (req: Request): UserSession | null => {
  const token = req.cookies?.ambients_admin_token;
  if (!token) return null;
  return activeSessions.get(token) || null;
};

// --- AUTH ROUTE HANDLER ---
const handleAuth = (req: Request, res: Response) => {
  const method = req.method;
  const action = method === 'GET' ? 'session' : (req.body?.action || 'session');

  if (action === 'session') {
    const currentSession = getSession(req);
    if (currentSession) {
      return res.json({
        authenticated: true,
        configured: true,
        email: currentSession.email,
        displayName: currentSession.displayName,
        role: currentSession.role,
        mustChangePassword: currentSession.mustChangePassword,
        permissions: currentSession.permissions,
        impersonating: Boolean(currentSession.impersonating),
        impersonatedBy: currentSession.impersonatedBy || null,
      });
    }

    return res.json({
      authenticated: false,
      configured: true,
      email: null,
      displayName: null,
      role: null,
      mustChangePassword: false,
      permissions: [],
      impersonating: false,
      impersonatedBy: null,
    });
  }

  if (action === 'login' && method === 'POST') {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return res.status(400).json({
        authenticated: false,
        message: 'Enter a valid email address and password.',
      });
    }

    let role: 'admin' | 'operator' = 'admin';
    let displayName = adminProfile.displayName;
    let permissions = ['leads', 'new_leads', 'orders', 'products', 'integrations', 'chat'];
    let mustChangePassword = false;

    // Check if operator staff
    const staffUser = staffStore.find((s) => s.email.toLowerCase() === email && s.is_active);
    if (staffUser) {
      role = 'operator';
      displayName = staffUser.display_name;
      permissions = staffUser.permissions;
    } else {
      // Default to admin
      displayName = adminProfile.displayName || 'Administrator';
    }

    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const sessionData: UserSession = {
      email,
      displayName,
      role,
      permissions,
      mustChangePassword,
      impersonating: false,
    };
    activeSessions.set(sessionId, sessionData);

    res.cookie('ambients_admin_token', sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 28800 * 1000,
    });

    auditLogs.unshift({
      id: auditLogs.length + 1,
      actor_email: email,
      action: 'LOGIN_SUCCESS',
      entity_type: 'auth',
      entity_id: email,
      details: { role },
      created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    });

    return res.json({
      authenticated: true,
      configured: true,
      email,
      displayName,
      role,
      mustChangePassword,
      permissions,
      impersonating: false,
    });
  }

  if (action === 'logout' && method === 'POST') {
    const token = req.cookies?.ambients_admin_token;
    if (token) {
      activeSessions.delete(token);
      res.clearCookie('ambients_admin_token', { path: '/' });
    }
    return res.json({ authenticated: false });
  }

  if (action === 'update-profile' && method === 'POST') {
    const currentSession = getSession(req);
    if (!currentSession) {
      return res.status(401).json({ authenticated: false, message: 'Please sign in first.' });
    }

    const { displayName, email } = req.body || {};
    if (displayName) currentSession.displayName = String(displayName).trim();
    if (email) currentSession.email = String(email).trim().toLowerCase();

    if (currentSession.role === 'admin') {
      if (displayName) adminProfile.displayName = currentSession.displayName;
      if (email) adminProfile.email = currentSession.email;
    }

    return res.json({
      updated: true,
      email: currentSession.email,
      displayName: currentSession.displayName,
    });
  }

  if (action === 'change-password' && method === 'POST') {
    const currentSession = getSession(req);
    if (!currentSession) {
      return res.status(401).json({ authenticated: false, message: 'Please sign in first.' });
    }
    currentSession.mustChangePassword = false;
    return res.json({ updated: true });
  }

  return res.status(400).json({ message: 'Invalid action' });
};

// --- DATA ROUTE HANDLER ---
const handleData = (req: Request, res: Response) => {
  const method = req.method;
  const resource = String(req.query.resource || '');

  // 1. CATALOG
  if (resource === 'catalog' && method === 'GET') {
    return res.json({
      products: productsStore,
      categories: categoriesStore,
    });
  }

  // 2. PRODUCTS
  if (resource === 'products') {
    if (method === 'GET') {
      return res.json({ products: productsStore });
    }

    if (method === 'POST') {
      if (Array.isArray(req.body?.products)) {
        // Bulk upload
        const newItems = req.body.products as StoredProduct[];
        productsStore = [...newItems, ...productsStore];
        return res.json({ products: newItems });
      }

      const item = req.body as StoredProduct;
      const newItem: StoredProduct = {
        ...item,
        id: item.id || `prod-${Date.now()}`,
        inStock: (item.stockCount ?? 0) > 0,
        isActive: true,
      };
      productsStore.unshift(newItem);
      return res.json({ product: newItem });
    }

    if (method === 'PATCH') {
      const { category, bulkPercent, id, ...updates } = req.body || {};
      if (bulkPercent !== undefined) {
        const factor = 1 + Number(bulkPercent) / 100;
        productsStore = productsStore.map((p) => {
          if (category === 'All' || p.category === category) {
            return {
              ...p,
              price: Math.max(0, parseFloat((p.price * factor).toFixed(2))),
            };
          }
          return p;
        });
        return res.json({ message: 'Bulk price adjusted successfully' });
      }

      productsStore = productsStore.map((p) => {
        if (p.id === id) {
          const updated = { ...p, ...updates };
          if (updates.stockCount !== undefined) {
            updated.inStock = updates.stockCount > 0;
          }
          return updated;
        }
        return p;
      });
      const updatedProduct = productsStore.find((p) => p.id === id);
      return res.json({ product: updatedProduct });
    }

    if (method === 'DELETE') {
      const id = String(req.query.id || req.body?.id || '');
      productsStore = productsStore.filter((p) => p.id !== id);
      return res.json({ message: 'Product archived' });
    }
  }

  // 3. PRODUCT IMAGES
  if (resource === 'product-images' && method === 'POST') {
    return res.json({
      images: ['/ambients-mark.svg'],
    });
  }

  // 4. CATEGORIES
  if (resource === 'categories') {
    if (method === 'GET') {
      return res.json({ categories: categoriesStore });
    }
    if (method === 'POST') {
      const name = String(req.body?.name || '').trim();
      if (name && !categoriesStore.includes(name)) {
        categoriesStore.push(name);
        categoriesStore.sort((a, b) => a.localeCompare(b));
      }
      return res.json({ category: name });
    }
  }

  // 5. ORDERS
  if (resource === 'orders') {
    if (method === 'GET') {
      const orderId = req.query.id ? String(req.query.id) : null;
      if (orderId) {
        const order = ordersStore.find((o) => o.id === orderId || o.orderNumber === orderId);
        if (!order) return res.status(404).json({ message: 'Order not found' });
        return res.json({ order });
      }

      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
      const limit = Math.max(1, parseInt(String(req.query.limit || '25'), 10));
      const q = String(req.query.q || '').trim().toLowerCase();
      const statusFilter = String(req.query.status || '');

      let filtered = [...ordersStore];
      if (statusFilter && statusFilter !== 'All') {
        filtered = filtered.filter((o) => o.status === statusFilter);
      }
      if (q) {
        filtered = filtered.filter((o) =>
          o.orderNumber.toLowerCase().includes(q) ||
          o.patientName.toLowerCase().includes(q) ||
          o.email.toLowerCase().includes(q) ||
          (o.rxNumber && o.rxNumber.toLowerCase().includes(q)) ||
          (o.medicationName && o.medicationName.toLowerCase().includes(q))
        );
      }

      const total = filtered.length;
      const pages = Math.ceil(total / limit) || 1;
      const start = (page - 1) * limit;
      const pagedOrders = filtered.slice(start, start + limit);

      return res.json({
        orders: pagedOrders,
        pagination: { page, limit, total, pages },
      });
    }

    if (method === 'POST') {
      // Storefront checkout creation
      const {
        customerName,
        email,
        phone,
        deliveryMethod,
        deliveryAddress,
        couponCode,
        paymentMethod,
        items,
      } = req.body || {};

      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const randNum = Math.floor(100 + Math.random() * 900);
      const orderId = `ord-${Date.now()}`;
      const orderNumber = `ORD-${dateStr}-${randNum}`;

      const resolvedItems = (items || []).map((ci: { productId: string; quantity: number }) => {
        const prod = productsStore.find((p) => p.id === ci.productId);
        const qty = ci.quantity || 1;
        const unitPrice = prod?.price || 20.0;
        return {
          productId: ci.productId,
          name: prod?.name || 'Pharmacy Care Item',
          category: prod?.category || 'General Care',
          quantity: qty,
          unitPrice,
          dosage: prod?.dosage,
          rxRequired: prod?.rxRequired,
          image: prod?.image,
        };
      });

      const subtotal = resolvedItems.reduce((acc: number, item: any) => acc + item.unitPrice * item.quantity, 0);
      const discountAmount = couponCode ? subtotal * 0.1 : 0.0;
      const shippingFee = deliveryMethod === 'Express Courier' ? 12.0 : 0.0;
      const totalAmount = parseFloat((subtotal - discountAmount + shippingFee).toFixed(2));

      // Decrement stock
      for (const item of resolvedItems) {
        const prod = productsStore.find((p) => p.id === item.productId);
        if (prod) {
          prod.stockCount = Math.max(0, prod.stockCount - item.quantity);
          prod.inStock = prod.stockCount > 0;
        }
      }

      const newOrder: StoredOrder = {
        id: orderId,
        orderNumber,
        patientName: customerName || 'Valued Patient',
        email: email || 'patient@example.com',
        phone: phone || '',
        items: resolvedItems,
        subtotal,
        shippingFee,
        discountAmount,
        couponCode: couponCode || undefined,
        totalAmount,
        orderType: 'Store Purchase',
        deliveryMethod: deliveryMethod || 'Standard Home Delivery',
        deliveryAddress: deliveryAddress || '',
        paymentMethod: paymentMethod || 'Cash on Delivery / Pickup',
        paymentStatus: 'Pending',
        status: 'Submitted',
        placedAt: now.toISOString().replace('T', ' ').slice(0, 16),
        internalNotes: ['Storefront order received and verified.'],
      };

      ordersStore.unshift(newOrder);

      // Add or update lead
      const existingLead = leadsStore.find((l) => l.email.toLowerCase() === email.toLowerCase());
      if (existingLead) {
        existingLead.orderCount += 1;
        existingLead.activeOrderCount += 1;
        existingLead.lastOrderAt = newOrder.placedAt;
        existingLead.status = 'Customer';
      } else if (email) {
        const names = (customerName || '').split(' ');
        leadsStore.unshift({
          id: ++leadIdCounter,
          firstName: names[0] || 'Customer',
          lastName: names.slice(1).join(' ') || '',
          email,
          phone: phone || '',
          country: 'United States',
          leadSource: 'Online Order',
          createdAt: now.toISOString(),
          status: 'Customer',
          marketingConsent: true,
          marketingConsentAt: now.toISOString(),
          orderCount: 1,
          lastOrderAt: newOrder.placedAt,
          activeOrderCount: 1,
          callCount: 0,
          assignedStaffId: null,
          assignedStaffName: null,
        });
      }

      return res.json({ order: newOrder });
    }

    if (method === 'PATCH') {
      const { id, status, carrier, trackingNumber } = req.body || {};
      const order = ordersStore.find((o) => o.id === id);
      if (!order) return res.status(404).json({ message: 'Order not found' });

      const prevStatus = order.status;
      if (status) order.status = status;
      if (carrier !== undefined) order.carrier = carrier;
      if (trackingNumber !== undefined) order.trackingNumber = trackingNumber;

      // Handle stock restock on cancellation
      if (status === 'Cancelled' && prevStatus !== 'Cancelled') {
        for (const item of order.items || []) {
          const prod = productsStore.find((p) => p.id === item.productId);
          if (prod) {
            prod.stockCount += item.quantity;
            prod.inStock = prod.stockCount > 0;
          }
        }
      }

      return res.json({ message: 'Order updated', order });
    }
  }

  // 6. MANUAL ORDERS
  if (resource === 'manual-orders' && method === 'POST') {
    const { customerName, email, phone, deliveryMethod, deliveryAddress, productId, quantity } = req.body || {};
    const prod = productsStore.find((p) => p.id === productId);
    const qty = Number(quantity) || 1;
    const unitPrice = prod?.price || 25.0;
    const totalAmount = parseFloat((unitPrice * qty).toFixed(2));

    const now = new Date();
    const orderId = `ord-${Date.now()}`;
    const orderNumber = `ORD-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(100 + Math.random() * 900)}`;

    if (prod) {
      prod.stockCount = Math.max(0, prod.stockCount - qty);
      prod.inStock = prod.stockCount > 0;
    }

    const newOrder: StoredOrder = {
      id: orderId,
      orderNumber,
      patientName: customerName,
      email,
      phone: phone || '',
      items: [
        {
          productId,
          name: prod?.name || 'Prescription Product',
          category: prod?.category || 'General Care',
          quantity: qty,
          unitPrice,
          dosage: prod?.dosage,
          rxRequired: prod?.rxRequired,
        },
      ],
      subtotal: totalAmount,
      shippingFee: 0,
      discountAmount: 0,
      totalAmount,
      orderType: 'Manual Entry',
      deliveryMethod: deliveryMethod || 'Standard Home Delivery',
      deliveryAddress: deliveryAddress || '',
      paymentMethod: 'Cash on Delivery / Pickup',
      paymentStatus: 'Pending',
      status: 'Submitted',
      placedAt: now.toISOString().replace('T', ' ').slice(0, 16),
      internalNotes: ['Manual order created by operations staff.'],
    };

    ordersStore.unshift(newOrder);
    return res.json({ order: newOrder });
  }

  // 7. ORDER NOTES
  if (resource === 'order-notes' && method === 'POST') {
    const { orderId, note } = req.body || {};
    const order = ordersStore.find((o) => o.id === orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    order.internalNotes = order.internalNotes || [];
    order.internalNotes.unshift(String(note));
    return res.json({ note, updatedAt: new Date().toISOString() });
  }

  // 8. LEADS
  if (resource === 'leads') {
    if (method === 'GET') {
      const leadId = req.query.id ? Number(req.query.id) : null;
      if (leadId) {
        const lead = leadsStore.find((l) => l.id === leadId);
        if (!lead) return res.status(404).json({ message: 'Lead not found' });
        const leadOrders = ordersStore.filter((o) => o.email.toLowerCase() === lead.email.toLowerCase());
        const leadActivities = activitiesStore.filter((a) => a.leadId === leadId);
        return res.json({
          lead,
          orders: leadOrders,
          activities: leadActivities,
        });
      }
      return res.json({ leads: leadsStore });
    }

    if (method === 'POST') {
      const incoming = Array.isArray(req.body?.leads) ? req.body.leads : [req.body];
      const createdLeads: StoredLead[] = [];
      const now = new Date().toISOString();

      for (const item of incoming) {
        const existing = leadsStore.find((l) => l.email.toLowerCase() === (item.email || '').toLowerCase());
        if (existing) {
          createdLeads.push(existing);
          continue;
        }

        const newLead: StoredLead = {
          id: ++leadIdCounter,
          firstName: item.firstName || 'Contact',
          lastName: item.lastName || '',
          email: item.email || '',
          phone: item.phone || '',
          country: item.country || 'United States',
          leadSource: item.leadSource || 'Manual Entry',
          createdAt: now,
          status: item.status || 'New',
          marketingConsent: Boolean(item.marketingConsent),
          marketingConsentAt: item.marketingConsent ? now : null,
          orderCount: 0,
          lastOrderAt: null,
          activeOrderCount: 0,
          callCount: 0,
          assignedStaffId: null,
          assignedStaffName: null,
        };
        leadsStore.unshift(newLead);
        createdLeads.push(newLead);
      }
      return res.json({ leads: createdLeads, lead: createdLeads[0] });
    }

    if (method === 'PATCH') {
      const { id, ...updates } = req.body || {};
      const lead = leadsStore.find((l) => l.id === Number(id));
      if (!lead) return res.status(404).json({ message: 'Lead not found' });

      Object.assign(lead, updates);
      return res.json({ lead });
    }
  }

  // 9. LEAD ACTIVITIES
  if (resource === 'lead-activities' && method === 'POST') {
    const { leadId, activityType, note, callOutcome, followUpDate } = req.body || {};
    const lead = leadsStore.find((l) => l.id === Number(leadId));
    if (!lead) return res.status(404).json({ message: 'Lead not found' });

    if (activityType === 'Call') {
      lead.callCount = (lead.callCount || 0) + 1;
    }

    const currentSession = getSession(req);
    const newActivity: StoredActivity = {
      id: activitiesStore.length + 1,
      leadId: Number(leadId),
      activityType: activityType || 'Note',
      note: note || '',
      callOutcome,
      followUpDate,
      authorEmail: currentSession?.email || 'admin@ambients.com',
      authorName: currentSession?.displayName || 'Administrator',
      createdAt: new Date().toISOString(),
    };
    activitiesStore.unshift(newActivity);
    return res.json({ activity: newActivity });
  }

  // 10. OVERVIEW
  if (resource === 'overview' && method === 'GET') {
    const byStatus: Record<string, number> = {};
    for (const o of ordersStore) {
      byStatus[o.status] = (byStatus[o.status] || 0) + 1;
    }

    const lowStock = productsStore.filter((p) => p.stockCount <= p.minStockThreshold);

    return res.json({
      orders: {
        total: ordersStore.length,
        byStatus,
      },
      leads: leadsStore.length,
      products: productsStore.length,
      lowStockCount: lowStock.length,
      lowStock: lowStock.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        stockCount: p.stockCount,
        minStockThreshold: p.minStockThreshold,
      })),
      recentOrders: ordersStore.slice(0, 5),
    });
  }

  // 11. AUDIT
  if (resource === 'audit' && method === 'GET') {
    return res.json({ entries: auditLogs });
  }

  // 12. STAFF
  if (resource === 'staff') {
    if (method === 'GET') {
      return res.json({ staff: staffStore });
    }

    if (method === 'POST') {
      const { email, displayName, permissions } = req.body || {};
      const newStaff: StaffUser = {
        id: staffStore.length + 1,
        email: String(email).trim().toLowerCase(),
        display_name: String(displayName).trim(),
        role: 'operator',
        permissions: permissions || ['leads', 'orders'],
        is_active: true,
        created_by: 'afosterofficial@gmail.com',
        created_at: new Date().toISOString(),
        assigned_lead_count: 0,
      };
      staffStore.push(newStaff);
      return res.json({ staff: newStaff });
    }

    if (method === 'PATCH') {
      const { id, is_active, permissions, displayName } = req.body || {};
      const user = staffStore.find((s) => s.id === Number(id));
      if (user) {
        if (is_active !== undefined) user.is_active = Boolean(is_active);
        if (permissions !== undefined) user.permissions = permissions;
        if (displayName !== undefined) user.display_name = displayName;
      }
      return res.json({ staff: user });
    }
  }

  // 13. STAFF PRESENCE & ROUTING
  if (resource === 'staff-presence') {
    if (method === 'GET') {
      return res.json({
        admin: { online: true, durationSeconds: 3600, currentSection: 'workspace' },
        staff: staffStore.map((s) => ({
          id: s.id,
          displayName: s.display_name,
          email: s.email,
          active: s.is_active,
          online: true,
          durationSeconds: 1800,
          currentSection: 'inbox',
          lastSeenAt: new Date().toISOString(),
        })),
      });
    }
    return res.json({ success: true });
  }

  if (resource === 'crm-routing-settings') {
    if (method === 'GET') {
      return res.json(crmRoutingSettings);
    }
    if (method === 'POST') {
      if (req.body?.agentsMayClaimWhenAdminOnline !== undefined) {
        crmRoutingSettings.agentsMayClaimWhenAdminOnline = Boolean(req.body.agentsMayClaimWhenAdminOnline);
      }
      return res.json(crmRoutingSettings);
    }
  }

  // 14. STAFF SESSION IMPERSONATION
  if (resource === 'staff-session' && method === 'POST') {
    const currentSession = getSession(req);
    if (!currentSession) return res.status(401).json({ message: 'Unauthorized' });

    if (req.body?.revert) {
      currentSession.role = 'admin';
      currentSession.email = adminProfile.email;
      currentSession.displayName = adminProfile.displayName;
      currentSession.permissions = ['leads', 'new_leads', 'orders', 'products', 'integrations', 'chat'];
      currentSession.impersonating = false;
      currentSession.impersonatedBy = undefined;
      return res.json({ success: true, session: currentSession });
    }

    const targetStaff = staffStore.find((s) => s.id === Number(req.body?.staffId));
    if (targetStaff) {
      currentSession.role = 'operator';
      currentSession.email = targetStaff.email;
      currentSession.displayName = targetStaff.display_name;
      currentSession.permissions = targetStaff.permissions;
      currentSession.impersonating = true;
      currentSession.impersonatedBy = adminProfile.email;
      return res.json({ success: true, session: currentSession });
    }
    return res.status(404).json({ message: 'Staff user not found' });
  }

  // 15. VISITOR SESSION
  if (resource === 'visitor-session' && method === 'POST') {
    const { sessionToken, visitorToken, path: vPath, title, productId, referrerDomain, language } = req.body || {};
    const now = new Date().toISOString();
    const existing = visitorSessionsStore.find((s) => s.id === sessionToken);
    if (existing) {
      existing.lastSeen = now;
      existing.pageCount += 1;
      existing.active = true;
      if (vPath) existing.currentPath = vPath;
      if (title) existing.currentTitle = title;
      if (productId) existing.currentProduct = productId;
    } else if (sessionToken) {
      visitorSessionsStore.unshift({
        id: sessionToken,
        visitorId: visitorToken || `vis-${Date.now().toString(36)}`,
        currentPath: vPath || '/',
        referrerDomain: referrerDomain || 'Direct',
        countryCode: 'US',
        language: language || 'en-US',
        firstSeen: now,
        lastSeen: now,
        active: true,
        pageCount: 1,
        durationSeconds: 60,
        currentTitle: title || 'Ambients Pharmacy & Wellness',
        currentProduct: productId || null,
        chatId: null,
        chatStatus: null,
        chatOwner: null,
        chatEngaged: false,
      });
    }
    return res.json({ success: true });
  }

  if (resource === 'visitor-sessions' && method === 'GET') {
    const sessionToken = req.query.session ? String(req.query.session) : null;
    if (sessionToken) {
      const target = visitorSessionsStore.find((s) => s.id === sessionToken) || visitorSessionsStore[0];
      if (!target) return res.status(404).json({ message: 'Session not found' });
      return res.json({
        session: target,
        pages: [
          {
            path: target.currentPath,
            title: target.currentTitle,
            productId: target.currentProduct,
            productName: target.currentProduct,
            dwellSeconds: 90,
            viewedAt: target.lastSeen,
          },
        ],
      });
    }

    const activeCount = visitorSessionsStore.filter((s) => s.active).length;
    return res.json({
      sessions: visitorSessionsStore.slice(0, 30),
      summary: {
        activeSessions: Math.max(1, activeCount),
        activeVisitors: Math.max(1, activeCount),
        recentSessions: Math.max(15, visitorSessionsStore.length * 2),
        recentVisitors: Math.max(12, visitorSessionsStore.length),
      },
    });
  }

  // 16. CHAT
  if (resource === 'chat' && method === 'POST') {
    const { action, name, email, phone, message, conversation: convId } = req.body || {};
    const now = new Date().toISOString();

    if (action === 'start') {
      const newConv: ChatConversation = {
        id: conversationsStore.length + 1,
        visitorName: name || 'Visitor',
        visitorEmail: email || 'visitor@example.com',
        visitorPhone: phone || '',
        status: 'open',
        createdAt: now,
        updatedAt: now,
        lastMessage: message || 'Hello!',
        lastSender: 'visitor',
        unreadCount: 1,
        ownerType: 'queue',
        ownerStaffId: null,
        ownerName: 'Unassigned Queue',
        canClaim: true,
      };
      conversationsStore.unshift(newConv);

      const newMsg: ChatMessage = {
        id: chatMessagesStore.length + 1,
        conversationId: newConv.id,
        sender: 'visitor',
        senderName: newConv.visitorName,
        body: message || 'Hello!',
        createdAt: now,
      };
      chatMessagesStore.push(newMsg);

      const token = crypto.createHash('sha256').update(`${newConv.id}-${Date.now()}-${Math.random()}`).digest('hex');

      return res.json({
        conversation: { id: newConv.id, status: newConv.status },
        token,
        messages: [newMsg],
      });
    }

    if (action === 'read') {
      const conv = conversationsStore.find((c) => c.id === Number(convId));
      if (!conv) return res.status(404).json({ message: 'Conversation not found' });
      const msgs = chatMessagesStore.filter((m) => m.conversationId === Number(convId));
      return res.json({ conversation: conv, messages: msgs });
    }

    if (action === 'message') {
      const conv = conversationsStore.find((c) => c.id === Number(convId));
      if (!conv) return res.status(404).json({ message: 'Conversation not found' });

      const newMsg: ChatMessage = {
        id: chatMessagesStore.length + 1,
        conversationId: conv.id,
        sender: 'visitor',
        senderName: conv.visitorName,
        body: message || '',
        createdAt: now,
      };
      chatMessagesStore.push(newMsg);
      conv.updatedAt = now;
      conv.lastMessage = newMsg.body;
      conv.lastSender = 'visitor';
      conv.unreadCount += 1;

      const msgs = chatMessagesStore.filter((m) => m.conversationId === conv.id);
      return res.json({ message: newMsg, messages: msgs });
    }
  }

  // 17. CHAT ADMIN
  if (resource === 'chat-admin') {
    if (method === 'GET') {
      const convId = req.query.conversation ? Number(req.query.conversation) : null;
      if (convId) {
        const conv = conversationsStore.find((c) => c.id === convId);
        const msgs = chatMessagesStore.filter((m) => m.conversationId === convId);
        return res.json({ conversation: conv, messages: msgs });
      }

      return res.json({
        conversations: conversationsStore,
        adminOnline: true,
        assignableAgents: staffStore.map((s) => ({ id: s.id, displayName: s.display_name })),
      });
    }

    if (method === 'POST') {
      const { action, conversation: convId, message, agentId } = req.body || {};
      const conv = conversationsStore.find((c) => c.id === Number(convId));
      if (!conv) return res.status(404).json({ message: 'Conversation not found' });
      const now = new Date().toISOString();

      if (action === 'reply') {
        const currentSession = getSession(req);
        const newMsg: ChatMessage = {
          id: chatMessagesStore.length + 1,
          conversationId: conv.id,
          sender: 'staff',
          senderName: currentSession?.displayName || 'Sarah Jenkins, PharmD',
          body: message || '',
          createdAt: now,
        };
        chatMessagesStore.push(newMsg);
        conv.updatedAt = now;
        conv.lastMessage = newMsg.body;
        conv.lastSender = 'staff';
        conv.unreadCount = 0;
        return res.json({ success: true, message: newMsg });
      }

      if (action === 'close') {
        conv.status = 'closed';
        conv.updatedAt = now;
        return res.json({ success: true, conversation: conv });
      }

      if (action === 'assign') {
        const staff = staffStore.find((s) => s.id === Number(agentId));
        conv.ownerStaffId = staff ? staff.id : null;
        conv.ownerName = staff ? staff.display_name : 'Unassigned Queue';
        conv.ownerType = staff ? 'agent' : 'queue';
        conv.updatedAt = now;
        return res.json({ success: true, conversation: conv });
      }
    }
  }

  // 18. EMAIL & HOSTINGER INTEGRATIONS
  if (resource.startsWith('email-')) {
    if (resource === 'email-settings') {
      return res.json({
        configured: true,
        verified: true,
        emailAccount: 'customersupport@ambienta.io',
        displayName: 'Ambients Customer Support',
        smtpHost: 'smtp.hostinger.com',
        smtpPort: 465,
      });
    }

    if (resource === 'email-campaign-audience') {
      return res.json({
        count: leadsStore.filter((l) => l.marketingConsent).length,
      });
    }

    if (resource === 'email-campaigns') {
      return res.json({ campaigns: [] });
    }

    if (resource === 'email-drafts' || resource === 'email-draft-trash') {
      return res.json({ drafts: [] });
    }

    if (resource === 'email-activity') {
      return res.json({
        activities: [
          {
            id: 'act-1',
            recipientEmail: 'eleanor.vance@wellnessmail.com',
            subject: 'Your Ambients Order ORD-20261102-108 has been dispatched',
            sentAt: '2026-11-02 04:00 AM',
            status: 'Delivered',
          },
        ],
        total: 1,
      });
    }

    return res.json({
      sent: true,
      success: true,
      message: 'Hostinger email processed successfully.',
    });
  }

  return res.json({ message: 'OK' });
};

// Mount API routes
app.all('/api/auth.php', handleAuth);
app.all('/api/auth', handleAuth);
app.all('/api/data.php', handleData);
app.all('/api/data', handleData);

// Serve frontend: Vite dev middlewares or static production files
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.resolve(__dirname, 'dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  });
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true, host: HOST, port: PORT },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.listen(PORT, HOST, () => {
  console.log(`Ambients server listening at http://${HOST}:${PORT}`);
});
