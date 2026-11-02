/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { PharmacyHero } from './components/PharmacyHero';
import { CategoriesAndProducts } from './components/CategoriesAndProducts';
import { CartDrawer } from './components/CartDrawer';
import { CheckoutModal } from './components/CheckoutModal';
import { AdminLayout } from './components/Admin/AdminLayout';
import {
  INITIAL_PATIENTS,
  INITIAL_ORDERS,
  INITIAL_HOSTINGER_CONFIG,
  INITIAL_EMAIL_LOGS,
  INITIAL_REMINDER_RULES,
  CATALOG_ITEMS as INITIAL_CATALOG,
} from './data/seedData';
import {
  Patient,
  OnlineOrder,
  HostingerConfig,
  EmailLog,
  ReminderRule,
  PharmacistNote,
  CatalogItem,
  CartItem,
  StoreCategory,
} from './types/pharmacy';
import { ShieldCheck, Truck, Shield, Sparkles, Phone, Mail, MapPin } from 'lucide-react';

export default function App() {
  // Current route state: inspect window.location.pathname
  const [currentPath, setCurrentPath] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return window.location.pathname.startsWith('/admin') ? '/admin' : '/';
    }
    return '/';
  });

  // Master application states
  const [patients, setPatients] = useState<Patient[]>(INITIAL_PATIENTS);
  const [orders, setOrders] = useState<OnlineOrder[]>(INITIAL_ORDERS);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>(INITIAL_CATALOG);
  const [hostingerConfig, setHostingerConfig] = useState<HostingerConfig>(INITIAL_HOSTINGER_CONFIG);
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>(INITIAL_EMAIL_LOGS);
  const [reminderRules, setReminderRules] = useState<ReminderRule[]>(INITIAL_REMINDER_RULES);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  // Storefront Filter States
  const [selectedCategory, setSelectedCategory] = useState<StoreCategory | 'All Products'>('All Products');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals state
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);

  // Sync with browser navigation
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname.startsWith('/admin') ? '/admin' : '/';
      setCurrentPath(path);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = (path: string) => {
    window.history.pushState(null, '', path);
    setCurrentPath(path.startsWith('/admin') ? '/admin' : '/');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Cart Handlers
  const handleAddToCart = (item: CatalogItem) => {
    setCartItems((prev) => {
      const existing = prev.find((ci) => ci.item.id === item.id);
      if (existing) {
        return prev.map((ci) =>
          ci.item.id === item.id ? { ...ci, quantity: ci.quantity + 1 } : ci
        );
      }
      return [...prev, { item, quantity: 1 }];
    });
    setIsCartOpen(true);
  };

  const handleUpdateCartQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      handleRemoveCartItem(productId);
      return;
    }
    setCartItems((prev) =>
      prev.map((ci) => (ci.item.id === productId ? { ...ci, quantity } : ci))
    );
  };

  const handleRemoveCartItem = (productId: string) => {
    setCartItems((prev) => prev.filter((ci) => ci.item.id !== productId));
  };

  const handleClearCart = () => {
    setCartItems([]);
  };

  const handleOrderCreated = (order: OnlineOrder) => {
    setOrders((prev) => [order, ...prev]);

    // Decrement catalog item stock based on purchased items
    if (order.items && order.items.length > 0) {
      setCatalogItems((prevCatalog) =>
        prevCatalog.map((product) => {
          const purchased = order.items?.find((item) => item.productId === product.id);
          if (purchased) {
            const newStock = Math.max(0, product.stockCount - purchased.quantity);
            return {
              ...product,
              stockCount: newStock,
              inStock: newStock > 0,
            };
          }
          return product;
        })
      );
    }

  };

  const handleUpdateOrderTracking = (orderId: string, carrier: string, trackingNumber: string) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, carrier, trackingNumber } : o))
    );
  };

  const handleAddOrderInternalNote = (orderId: string, note: string) => {
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId ? { ...o, internalNotes: [note, ...(o.internalNotes || [])] } : o
      )
    );
  };

  const handleAddManualOrder = (order: OnlineOrder) => {
    setOrders((prev) => [order, ...prev]);
  };

  // Inventory Management Handlers
  const handleAddProduct = (newProduct: CatalogItem) => {
    setCatalogItems((prev) => [newProduct, ...prev]);
  };

  const handleUpdateProduct = (updatedProduct: CatalogItem) => {
    setCatalogItems((prev) =>
      prev.map((item) => (item.id === updatedProduct.id ? updatedProduct : item))
    );
  };

  const handleDeleteProduct = (productId: string) => {
    setCatalogItems((prev) => prev.filter((item) => item.id !== productId));
  };

  const handleBulkPriceAdjust = (category: string, percentChange: number) => {
    setCatalogItems((prev) =>
      prev.map((item) => {
        if (category === 'All' || item.category === category) {
          const factor = 1 + percentChange / 100;
          return {
            ...item,
            price: Math.max(0, parseFloat((item.price * factor).toFixed(2))),
          };
        }
        return item;
      })
    );
  };

  // Clinical CRM Handlers
  const handleAddPharmacistNote = (
    patientId: string,
    note: Omit<PharmacistNote, 'id' | 'createdAt'>
  ) => {
    const fullNote: PharmacistNote = {
      ...note,
      id: `note-${Date.now()}`,
      createdAt: '2026-11-02 04:55 AM',
    };

    setPatients((prev) =>
      prev.map((p) => (p.id === patientId ? { ...p, notes: [fullNote, ...p.notes] } : p))
    );

    if (selectedPatient && selectedPatient.id === patientId) {
      setSelectedPatient({
        ...selectedPatient,
        notes: [fullNote, ...selectedPatient.notes],
      });
    }
  };

  const handleTriggerRefillDispense = (patientId: string, rxNumber: string) => {
    setPatients((prev) =>
      prev.map((p) => {
        if (p.id !== patientId) return p;
        const updatedRefills = p.refillHistory.map((r) => {
          if (r.rxNumber === rxNumber) {
            return {
              ...r,
              remainingRefills: Math.max(0, r.remainingRefills - 1),
              dateFilled: '2026-11-02',
              nextRefillDue: '2026-12-02',
              status: 'Active' as const,
            };
          }
          return r;
        });
        return { ...p, refillHistory: updatedRefills };
      })
    );

    if (selectedPatient && selectedPatient.id === patientId) {
      const updatedRefills = selectedPatient.refillHistory.map((r) => {
        if (r.rxNumber === rxNumber) {
          return {
            ...r,
            remainingRefills: Math.max(0, r.remainingRefills - 1),
            dateFilled: '2026-11-02',
            nextRefillDue: '2026-12-02',
            status: 'Active' as const,
          };
        }
        return r;
      });
      setSelectedPatient({ ...selectedPatient, refillHistory: updatedRefills });
    }
  };

  const handleImportPatients = (imported: Partial<Patient>[]) => {
    const newPatients: Patient[] = imported.map((item, idx) => ({
      id: `pat-import-${Date.now()}-${idx}`,
      firstName: item.firstName || 'Imported',
      lastName: item.lastName || `Client ${idx + 1}`,
      email: item.email || `lead${idx + 1}@caremail.com`,
      phone: item.phone || '+1 (555) 200-0000',
      dateOfBirth: '1975-06-15',
      address: 'Midwest Regional Service Corridor',
      insuranceProvider: 'Standard Healthcare',
      insurancePolicyNumber: `POL-${Math.floor(100000 + Math.random() * 900000)}`,
      healthCategory: item.healthCategory || 'General Care',
      primaryDoctor: item.primaryDoctor || 'Dr. Helen Brody, MD',
      allergies: [],
      activeMedicationsCount: item.refillHistory?.length || 1,
      nextRenewalDate: item.nextRenewalDate || '2026-11-20',
      leadSource: 'CSV Upload',
      createdAt: '2026-11-02',
      notes: [],
      refillHistory: item.refillHistory || [],
    }));

    setPatients((prev) => [...newPatients, ...prev]);
  };

  const handleAddManualPatient = (patient: Patient) => {
    setPatients((prev) => [patient, ...prev]);
  };

  const handleSendSingleEmail = (log: EmailLog) => {
    setEmailLogs((prev) => [log, ...prev]);
  };

  const handleBatchSendEmails = (logs: EmailLog[]) => {
    setEmailLogs((prev) => [...logs, ...prev]);
  };

  const handleToggleReminderRule = (ruleId: string) => {
    setReminderRules((prev) =>
      prev.map((r) => (r.id === ruleId ? { ...r, isActive: !r.isActive } : r))
    );
  };

  const handleUpdateOrderStatus = (orderId: string, newStatus: OnlineOrder['status']) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o))
    );
  };

  const totalCartCount = cartItems.reduce((acc, ci) => acc + ci.quantity, 0);

  // If user is at /admin, render the dedicated Staff CRM & Dispensary Operations Portal
  if (currentPath === '/admin') {
    return (
      <AdminLayout
        onNavigateHome={() => navigateTo('/')}
        patients={patients}
        onSelectPatient={(p) => setSelectedPatient(p)}
        onImportPatients={handleImportPatients}
        onAddManualPatient={handleAddManualPatient}
        catalogItems={catalogItems}
        onAddProduct={handleAddProduct}
        onUpdateProduct={handleUpdateProduct}
        onDeleteProduct={handleDeleteProduct}
        onBulkPriceAdjust={handleBulkPriceAdjust}
        hostingerConfig={hostingerConfig}
        onUpdateHostingerConfig={setHostingerConfig}
        emailLogs={emailLogs}
        onSendEmail={handleSendSingleEmail}
        onBatchSendEmails={handleBatchSendEmails}
        reminderRules={reminderRules}
        onToggleReminderRule={handleToggleReminderRule}
        orders={orders}
        onUpdateOrderStatus={handleUpdateOrderStatus}
        onUpdateOrderTracking={handleUpdateOrderTracking}
        onAddOrderInternalNote={handleAddOrderInternalNote}
        onAddManualOrder={handleAddManualOrder}
        selectedPatient={selectedPatient}
        onClosePatientModal={() => setSelectedPatient(null)}
        onAddPharmacistNote={handleAddPharmacistNote}
        onTriggerRefillDispense={handleTriggerRefillDispense}
      />
    );
  }

  // Otherwise, render the Customer Storefront at /
  return (
    <div className="min-h-screen bg-white flex flex-col font-sans text-slate-900">
      {/* Top Store Navigation */}
      <Navbar
        onNavigateHome={() => {
          setSelectedCategory('All Products');
          setSearchQuery('');
          navigateTo('/');
        }}
        onNavigateAdmin={() => navigateTo('/admin')}
        openCart={() => setIsCartOpen(true)}
        cartCount={totalCartCount}
        selectedCategory={selectedCategory}
        onSelectCategory={(cat) => setSelectedCategory(cat)}
      />

      {/* Main Storefront Body: Products Section as requested */}
      <main className="flex-1">
        {/* Store Hero Banner */}
        <PharmacyHero
          selectedCategory={selectedCategory}
          onSelectCategory={(cat) => setSelectedCategory(cat)}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
        />

        {/* Store Catalog & Filterable Products */}
        <CategoriesAndProducts
          catalogItems={catalogItems}
          onSelectItem={handleAddToCart}
          selectedCategory={selectedCategory}
          onSelectCategory={(cat) => setSelectedCategory(cat)}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
        />

        {/* Value & Delivery Banner */}
        <section className="border-t border-blue-100 bg-white py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2 rounded-xl border border-blue-100 bg-[#f4f8fc] p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#174c80] font-bold text-white">
                  <Sparkles className="h-5 w-5 text-blue-100" />
                </div>
                <h4 className="text-base font-bold text-slate-900">Targeted Wellness Formulations</h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Carefully engineered supplements and therapies for sleep induction, metabolic weight control, cardiovascular vitality, and daily cellular health.
                </p>
              </div>

              <div className="space-y-2 rounded-xl border border-blue-100 bg-[#f4f8fc] p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#174c80] font-bold text-white">
                  <ShieldCheck className="h-5 w-5 text-blue-100" />
                </div>
                <h4 className="text-base font-bold text-slate-900">Licensed Clinical Oversight</h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Every order is reviewed and packaged under the supervision of on-duty clinical staff, ensuring high purity, dosage safety, and compatibility.
                </p>
              </div>

              <div className="space-y-2 rounded-xl border border-blue-100 bg-[#f4f8fc] p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#174c80] font-bold text-white">
                  <Truck className="h-5 w-5 text-blue-100" />
                </div>
                <h4 className="text-base font-bold text-slate-900">Fast &amp; Discreet Courier Shipping</h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Choose the delivery option that works for you. Order updates and carrier tracking require the fulfillment integrations to be configured.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Customer Store Footer */}
      <footer className="border-t border-[#0b2f52] bg-[#123b68] py-12 text-blue-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="space-y-1 text-center md:text-left">
              <span className="font-bold text-lg text-white block">AuraCare Health &amp; Wellness Store</span>
              <p className="text-xs text-slate-400">
                Thoughtfully selected wellness essentials · Care team support · Convenient delivery
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs font-semibold">
              <button
                onClick={() => setSelectedCategory('Sleep')}
                className="text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                Sleep Remedies
              </button>
              <button
                onClick={() => setSelectedCategory('Weight Loss')}
                className="text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                Weight Loss
              </button>
              <button
                onClick={() => setSelectedCategory('Energy & Focus')}
                className="text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                Energy &amp; Focus
              </button>
              <button
                onClick={() => setIsCartOpen(true)}
                className="text-blue-200 transition-colors hover:text-white"
              >
                View Cart ({totalCartCount})
              </button>
              <button
                onClick={() => navigateTo('/admin')}
                className="flex items-center gap-1.5 rounded-lg bg-white/15 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-white/25"
              >
                <Shield className="h-3.5 w-3.5 text-blue-200" />
                <span>Staff CRM &amp; Admin (/admin)</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col items-center justify-between gap-2 border-t border-white/15 pt-6 text-[11px] text-blue-100/70 sm:flex-row">
            <span>© 2026 AuraCare Health Store. All rights reserved.</span>
            <span>Preview storefront · payments and mail are not connected</span>
          </div>
        </div>
      </footer>

      {/* Cart Drawer */}
      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cartItems={cartItems}
        onUpdateQuantity={handleUpdateCartQuantity}
        onRemoveItem={handleRemoveCartItem}
        onOpenCheckout={() => {
          setIsCartOpen(false);
          setIsCheckoutOpen(true);
        }}
      />

      {/* Checkout order capture */}
      <CheckoutModal
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        cartItems={cartItems}
        onOrderSuccess={handleOrderCreated}
        onClearCart={handleClearCart}
      />
    </div>
  );
}
