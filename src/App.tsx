/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Navbar } from './components/Navbar';
import { PharmacyHero } from './components/PharmacyHero';
import { CategoriesAndProducts } from './components/CategoriesAndProducts';
import { CartDrawer } from './components/CartDrawer';
import { CheckoutModal } from './components/CheckoutModal';
import { AdminLayout } from './components/Admin/AdminLayout';
import { AdminLogin } from './components/Admin/AdminLogin';
import { CATALOG_ITEMS as INITIAL_CATALOG } from './data/seedData';
import {
  ContactLead,
  ContactLeadInput,
  ContactLeadUpdate,
  LeadActivity,
  LeadActivityInput,
  LeadProfile,
  OnlineOrder,
  CatalogItem,
  CartItem,
  StoreCategory,
} from './types/pharmacy';
import { ShieldCheck, Truck, Sparkles, Phone, Mail, MapPin } from 'lucide-react';
import { RequiredPasswordChange } from './components/Admin/RequiredPasswordChange';
import type { OrderPagination, OrderSearch } from './components/Admin/AdminLayout';
import type { ProductCsvItem } from './utils/productCsv';

export default function App() {
  // Current route state: inspect window.location.pathname
  const [currentPath, setCurrentPath] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return window.location.pathname.startsWith('/admin') ? '/admin' : '/';
    }
    return '/';
  });
  const [adminAuthStatus, setAdminAuthStatus] = useState<'checking' | 'authenticated' | 'unauthenticated'>(
    () => (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')
      ? 'checking'
      : 'unauthenticated')
  );
  const [adminAuthSetupMessage, setAdminAuthSetupMessage] = useState<string>();
  const [adminRole, setAdminRole] = useState<'admin' | 'operator'>('admin');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminDisplayName, setAdminDisplayName] = useState('');
  const [mustChangePassword, setMustChangePassword] = useState(false);

  // Master application states
  const [orders, setOrders] = useState<OnlineOrder[]>([]);
  const [orderPagination, setOrderPagination] = useState<OrderPagination>({ page: 1, limit: 25, total: 0, pages: 0 });
  const [ordersLoading, setOrdersLoading] = useState(false);
  const orderRequestId = useRef(0);
  const [leads, setLeads] = useState<ContactLead[]>([]);
  const [adminDataError, setAdminDataError] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [categories, setCategories] = useState<string[]>(() => [...new Set(INITIAL_CATALOG.map((item) => item.category))]);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  useEffect(() => {
    let active = true;
    if (currentPath === '/admin') {
      return () => {
        active = false;
      };
    }

    fetch('/api/data.php?resource=catalog', { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const result = await response.json() as { products?: CatalogItem[]; categories?: string[]; message?: string };
        if (!response.ok || !Array.isArray(result.products) || !Array.isArray(result.categories)) {
          throw new Error(result.message || 'The live product catalog could not be loaded.');
        }
        if (active) {
          const seededById = new Map(INITIAL_CATALOG.map((item) => [item.id, item]));
          setCatalogItems(result.products.map((item) => ({
            ...seededById.get(item.id),
            ...item,
            ndcCode: item.ndcCode || undefined,
            image: item.image || seededById.get(item.id)?.image,
            costPrice: item.costPrice ?? seededById.get(item.id)?.costPrice,
            copayPrice: item.copayPrice ?? seededById.get(item.id)?.copayPrice,
            lastRestocked: item.lastRestocked || undefined,
          })));
          setCategories(result.categories);
          setCatalogError('');
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setCatalogError(error instanceof Error ? error.message : 'The live product catalog could not be loaded.');
        }
      });
    return () => {
      active = false;
    };
  }, [currentPath]);

  // Storefront Filter States
  const [selectedCategory, setSelectedCategory] = useState<StoreCategory | 'All Products'>('All Products');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals state
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);

  // Sync with browser navigation
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname.startsWith('/admin') ? '/admin' : '/';
      setCurrentPath(path);
      setAdminAuthStatus(path === '/admin' ? 'checking' : 'unauthenticated');
      setAdminAuthSetupMessage(undefined);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (currentPath !== '/admin') return;

    let isCurrent = true;
    setAdminAuthStatus('checking');
    fetch('/api/auth.php', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const result = await response.json() as {
          authenticated?: boolean;
          configured?: boolean;
          code?: string;
          message?: string;
          email?: string;
          displayName?: string;
          role?: 'admin' | 'operator';
          mustChangePassword?: boolean;
        };
        if (!isCurrent) return;

        if (response.ok && result.authenticated) {
          setAdminRole(result.role || 'admin');
          setAdminEmail(result.email || '');
          setAdminDisplayName(result.displayName || result.email || '');
          setMustChangePassword(Boolean(result.mustChangePassword));
          setAdminAuthStatus('authenticated');
          setAdminAuthSetupMessage(undefined);
          return;
        }

        setAdminAuthStatus('unauthenticated');
        setMustChangePassword(false);
        if (result.configured) {
          setAdminAuthSetupMessage(undefined);
          return;
        }
        setAdminAuthSetupMessage(
          result.message || 'The secure sign-in service is unavailable. Please try again later.'
        );
      })
      .catch(() => {
        if (!isCurrent) return;
        setAdminAuthStatus('unauthenticated');
        setMustChangePassword(false);
        setAdminAuthSetupMessage('The secure sign-in service could not be reached. Please try again later.');
      });

    return () => {
      isCurrent = false;
    };
  }, [currentPath]);

  useEffect(() => {
    if (currentPath !== '/admin' || adminAuthStatus !== 'authenticated' || mustChangePassword) return;

    let isCurrent = true;
    setAdminDataError('');
    setOrders([]);
    setLeads([]);
    const loadAdminData = async () => {
      try {
        const [leadsResponse, productsResponse] = await Promise.all([
          fetch('/api/data.php?resource=leads', { credentials: 'same-origin', headers: { Accept: 'application/json' } }),
          fetch('/api/data.php?resource=products', { credentials: 'same-origin', headers: { Accept: 'application/json' } }),
        ]);
        const [leadsResult, productsResult] = await Promise.all([
          leadsResponse.json() as Promise<{ leads?: ContactLead[]; message?: string }>,
          productsResponse.json() as Promise<{ products?: CatalogItem[]; message?: string }>,
        ]);
        if (!leadsResponse.ok || !Array.isArray(leadsResult.leads)) {
          throw new Error(leadsResult.message || 'Could not load saved contact leads from the database.');
        }
        if (!productsResponse.ok || !Array.isArray(productsResult.products)) {
          throw new Error(productsResult.message || 'Could not load the complete product catalog.');
        }
        if (isCurrent) {
          setLeads(leadsResult.leads);
          const seededById = new Map(INITIAL_CATALOG.map((item) => [item.id, item]));
          setCatalogItems(productsResult.products.map((item) => ({
            ...seededById.get(item.id),
            ...item,
            ndcCode: item.ndcCode || undefined,
            image: item.image || seededById.get(item.id)?.image,
            costPrice: item.costPrice ?? seededById.get(item.id)?.costPrice,
            copayPrice: item.copayPrice ?? seededById.get(item.id)?.copayPrice,
            lastRestocked: item.lastRestocked || undefined,
          })));
        }
      } catch (error) {
        if (!isCurrent) return;
        setAdminDataError(error instanceof Error ? error.message : 'The application database could not be reached.');
      }
    };

    void loadAdminData();
    return () => {
      isCurrent = false;
    };
  }, [currentPath, adminAuthStatus, mustChangePassword]);

  const handleLoadOrders = useCallback(async (search: OrderSearch) => {
    const requestId = ++orderRequestId.current;
    setOrdersLoading(true);
    try {
      const parameters = new URLSearchParams({
        page: String(search.page),
        limit: '25',
        q: search.query,
      });
      if (search.status !== 'All') parameters.set('status', search.status);
      const response = await fetch(`/api/data.php?resource=orders&${parameters.toString()}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const result = await response.json() as {
        orders?: OnlineOrder[];
        pagination?: OrderPagination;
        message?: string;
      };
      if (response.status === 401) {
        setAdminAuthStatus('unauthenticated');
        throw new Error('Your session has expired. Sign in again to continue.');
      }
      if (!response.ok || !Array.isArray(result.orders) || !result.pagination) {
        throw new Error(result.message || 'Saved orders could not be loaded.');
      }
      if (requestId !== orderRequestId.current) return;
      setOrders(result.orders);
      setOrderPagination(result.pagination);
      setAdminDataError('');
    } catch (error) {
      if (requestId !== orderRequestId.current) return;
      setAdminDataError(error instanceof Error ? error.message : 'Saved orders could not be loaded.');
    } finally {
      if (requestId === orderRequestId.current) setOrdersLoading(false);
    }
  }, []);

  const navigateTo = (path: string) => {
    window.history.pushState(null, '', path);
    const nextPath = path.startsWith('/admin') ? '/admin' : '/';
    setCurrentPath(nextPath);
    if (nextPath === '/admin') {
      setAdminAuthStatus('checking');
      setAdminAuthSetupMessage(undefined);
    } else {
      setAdminAuthStatus('unauthenticated');
      setAdminEmail('');
      setMustChangePassword(false);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAdminLogout = async () => {
    const response = await fetch('/api/auth.php', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ action: 'logout' }),
    });
    if (!response.ok) {
      throw new Error('The secure sign-out request failed. Please try again.');
    }
    setAdminAuthStatus('unauthenticated');
    navigateTo('/');
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

  const handleOrderCreated = async (order: OnlineOrder): Promise<OnlineOrder> => {
    const response = await fetch('/api/data.php?resource=orders', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        customerName: order.patientName,
        email: order.email,
        phone: order.phone,
        deliveryMethod: order.deliveryMethod,
        deliveryAddress: order.deliveryAddress,
        couponCode: order.couponCode || '',
        paymentMethod: order.paymentMethod,
        items: (order.items || []).map((item) => ({ productId: item.productId, quantity: item.quantity })),
      }),
    });
    const result = await response.json() as { order?: OnlineOrder; message?: string };
    if (!response.ok || !result.order) {
      throw new Error(result.message || 'The order could not be saved. Please try again.');
    }

    const savedOrder = result.order;
    setOrders((prev) => [savedOrder, ...prev]);

    // Decrement catalog item stock based on purchased items
    if (savedOrder.items && savedOrder.items.length > 0) {
      setCatalogItems((prevCatalog) =>
        prevCatalog.map((product) => {
          const purchased = savedOrder.items?.find((item) => item.productId === product.id);
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
    return savedOrder;
  };

  const handleUpdateOrderTracking = async (orderId: string, carrier: string, trackingNumber: string) => {
    const order = orders.find((item) => item.id === orderId);
    if (!order) throw new Error('The order is no longer on this page. Refresh the order list and try again.');
    try {
      const response = await fetch('/api/data.php?resource=orders', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id: orderId, status: order.status, carrier, trackingNumber }),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) {
        throw new Error(result.message || 'Order tracking could not be saved.');
      }
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, carrier, trackingNumber } : o))
      );
      setAdminDataError('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Order tracking could not be saved.';
      setAdminDataError(message);
      throw new Error(message);
    }
  };

  const handleAddOrderInternalNote = async (orderId: string, note: string): Promise<string> => {
    const response = await fetch('/api/data.php?resource=order-notes', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ orderId, note }),
    });
    const result = await response.json() as { note?: string; message?: string };
    if (!response.ok || typeof result.note !== 'string') {
      throw new Error(result.message || 'Order note could not be saved.');
    }
    const savedNote = result.note;
    setOrders((prev) => prev.map((order) => order.id === orderId
      ? { ...order, internalNotes: [savedNote, ...(order.internalNotes || [])] }
      : order));
    return savedNote;
  };

  // Inventory Management Handlers
  const handleAddProduct = async (newProduct: CatalogItem): Promise<CatalogItem> => {
    const response = await fetch('/api/data.php?resource=products', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(newProduct),
    });
    const result = await response.json() as { product?: CatalogItem; message?: string };
    if (!response.ok || !result.product) {
      throw new Error(result.message || 'The product could not be saved.');
    }
    const savedProduct = result.product;
    setCatalogItems((prev) => [savedProduct, ...prev]);
    return savedProduct;
  };

  const handleBulkAddProducts = async (products: ProductCsvItem[]): Promise<CatalogItem[]> => {
    const now = new Date().toISOString().slice(0, 10);
    const payload = products.map((product) => ({
      ...product,
      id: `prod-${crypto.randomUUID()}`,
      isActive: true,
      isFeatured: false,
      inStock: product.stockCount > 0,
      lastRestocked: product.stockCount > 0 ? now : undefined,
    }));
    const response = await fetch('/api/data.php?resource=products', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ products: payload }),
    });
    const result = await response.json() as { products?: CatalogItem[]; message?: string };
    if (!response.ok || !Array.isArray(result.products)) {
      throw new Error(result.message || 'The product import could not be saved.');
    }
    const savedProducts = result.products.map((item) => ({
      ...item,
      image: item.image || undefined,
      ndcCode: item.ndcCode || undefined,
      lastRestocked: item.lastRestocked || undefined,
    }));
    setCatalogItems((previous) => [...savedProducts, ...previous]);
    return savedProducts;
  };

  const handleAddCategory = async (name: string): Promise<string> => {
    const response = await fetch('/api/data.php?resource=categories', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ name }),
    });
    const result = await response.json() as { category?: string; message?: string };
    if (!response.ok || typeof result.category !== 'string') {
      throw new Error(result.message || 'The category could not be saved.');
    }
    const savedCategory = result.category;
    setCategories((previous) => [...previous, savedCategory].sort((a, b) => a.localeCompare(b)));
    return savedCategory;
  };

  const handleUpdateProduct = async (updatedProduct: CatalogItem): Promise<CatalogItem> => {
    const response = await fetch('/api/data.php?resource=products', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(updatedProduct),
    });
    const result = await response.json() as { product?: CatalogItem; message?: string };
    if (!response.ok || !result.product) {
      throw new Error(result.message || 'The product update could not be saved.');
    }
    const savedProduct = result.product;
    setCatalogItems((prev) => prev.map((item) => item.id === updatedProduct.id
      ? { ...item, ...savedProduct, image: savedProduct.image || item.image }
      : item));
    return savedProduct;
  };

  const handleDeleteProduct = async (productId: string) => {
    const response = await fetch(`/api/data.php?resource=products&id=${encodeURIComponent(productId)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    const result = await response.json() as { message?: string };
    if (!response.ok) throw new Error(result.message || 'The product could not be archived.');
    setCatalogItems((prev) => prev.filter((item) => item.id !== productId));
  };

  const handleBulkPriceAdjust = async (category: string, percentChange: number) => {
    const response = await fetch('/api/data.php?resource=products', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ category, bulkPercent: percentChange }),
    });
    const result = await response.json() as { message?: string };
    if (!response.ok) throw new Error(result.message || 'Bulk price changes could not be saved.');
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

  const handleUpdateOrderStatus = async (orderId: string, newStatus: OnlineOrder['status']) => {
    const order = orders.find((item) => item.id === orderId);
    if (!order) throw new Error('The order is no longer on this page. Refresh the order list and try again.');
    try {
      const response = await fetch('/api/data.php?resource=orders', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id: orderId, status: newStatus, carrier: order.carrier || '', trackingNumber: order.trackingNumber || '' }),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) {
        throw new Error(result.message || 'Order status could not be saved.');
      }
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o))
      );
      if (newStatus === 'Cancelled' && order.status !== 'Cancelled') {
        setCatalogItems((prev) => prev.map((product) => {
          const orderedItem = order.items?.find((item) => item.productId === product.id);
          return orderedItem
            ? { ...product, stockCount: product.stockCount + orderedItem.quantity, inStock: true }
            : product;
        }));
      }
      setAdminDataError('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Order status could not be saved.';
      setAdminDataError(message);
      throw new Error(message);
    }
  };

  const handleSaveLeads = async (newLeads: ContactLeadInput[]) => {
    const response = await fetch('/api/data.php?resource=leads', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ leads: newLeads }),
    });
    const result = await response.json() as { leads?: ContactLead[]; message?: string };
    if (!response.ok || !Array.isArray(result.leads)) {
      throw new Error(result.message || 'The contact leads could not be saved.');
    }
    setLeads((previous) => {
      const merged = new Map(previous.map((lead) => [lead.email.toLowerCase(), lead]));
      for (const lead of result.leads || []) merged.set(lead.email.toLowerCase(), lead);
      return [...merged.values()].sort((a, b) => b.id - a.id);
    });
  };

  const handleLoadLeadProfile = async (leadId: number): Promise<LeadProfile> => {
    const response = await fetch(`/api/data.php?resource=leads&id=${encodeURIComponent(String(leadId))}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    const result = await response.json() as { lead?: ContactLead; orders?: OnlineOrder[]; activities?: LeadActivity[]; message?: string };
    if (!response.ok || !result.lead || !Array.isArray(result.orders) || !Array.isArray(result.activities)) {
      throw new Error(result.message || 'The contact profile could not be loaded.');
    }
    return { lead: result.lead, orders: result.orders, activities: result.activities };
  };

  const handleUpdateLead = async (leadId: number, update: ContactLeadUpdate) => {
    const response = await fetch('/api/data.php?resource=leads', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ id: leadId, ...update }),
    });
    const result = await response.json() as { lead?: ContactLead; message?: string };
    if (!response.ok || !result.lead) {
      throw new Error(result.message || 'The contact lead could not be updated.');
    }
    const updatedLead = result.lead;
    setLeads((previous) => previous.map((lead) => lead.id === leadId ? updatedLead : lead));
    return updatedLead;
  };

  const handleAddLeadActivity = async (leadId: number, activity: LeadActivityInput) => {
    const response = await fetch('/api/data.php?resource=lead-activities', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ leadId, ...activity }),
    });
    const result = await response.json() as { activity?: LeadActivity; message?: string };
    if (!response.ok || !result.activity) {
      throw new Error(result.message || 'The lead activity could not be saved.');
    }
    return result.activity;
  };

  const handleCreateManualOrder = async (data: {
    customerName: string;
    email: string;
    phone: string;
    deliveryMethod: OnlineOrder['deliveryMethod'];
    deliveryAddress: string;
    productId: string;
    quantity: number;
  }): Promise<OnlineOrder> => {
    const response = await fetch('/api/data.php?resource=manual-orders', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await response.json() as { order?: OnlineOrder; message?: string };
    if (!response.ok || !result.order) {
      throw new Error(result.message || 'The manual order could not be saved.');
    }
    const savedOrder = result.order;
    setCatalogItems((previous) => previous.map((product) => {
      const item = savedOrder.items?.find((line) => line.productId === product.id);
      return item ? { ...product, stockCount: Math.max(0, product.stockCount - item.quantity), inStock: product.stockCount - item.quantity > 0 } : product;
    }));
    return savedOrder;
  };

  const totalCartCount = cartItems.reduce((acc, ci) => acc + ci.quantity, 0);

  // If user is at /admin, render the dedicated Staff CRM & Dispensary Operations Portal
  if (currentPath === '/admin' && adminAuthStatus === 'checking') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f1f7fc]">
        <p role="status" className="text-sm font-medium text-[#174c80]">Checking secure admin session…</p>
      </main>
    );
  }

  if (currentPath === '/admin' && adminAuthStatus !== 'authenticated') {
    return (
      <AdminLogin
        setupMessage={adminAuthSetupMessage}
        onAuthenticated={(role, shouldChangePassword, email, displayName) => {
          setAdminAuthSetupMessage(undefined);
          setAdminRole(role);
          setAdminEmail(email);
          setAdminDisplayName(displayName);
          setMustChangePassword(shouldChangePassword);
          setAdminAuthStatus('authenticated');
        }}
      />
    );
  }

  if (currentPath === '/admin' && mustChangePassword) {
    return (
      <RequiredPasswordChange
        onComplete={() => setMustChangePassword(false)}
        onLogout={handleAdminLogout}
      />
    );
  }

  if (currentPath === '/admin') {
    return (
      <AdminLayout
        onNavigateHome={() => navigateTo('/')}
        onLogout={handleAdminLogout}
        role={adminRole}
        email={adminEmail}
        displayName={adminDisplayName}
        onProfileUpdated={(email, displayName) => {
          setAdminEmail(email);
          setAdminDisplayName(displayName);
        }}
        leads={leads}
        leadDataError={adminDataError}
        dataError={adminDataError}
        onSaveLeads={handleSaveLeads}
        onLoadLeadProfile={handleLoadLeadProfile}
        onUpdateLead={handleUpdateLead}
        onAddLeadActivity={handleAddLeadActivity}
        categories={categories}
        catalogItems={catalogItems}
        catalogError={catalogError}
        onAddCategory={handleAddCategory}
        onBulkAddProducts={handleBulkAddProducts}
        onAddProduct={handleAddProduct}
        onUpdateProduct={handleUpdateProduct}
        onDeleteProduct={handleDeleteProduct}
        onBulkPriceAdjust={handleBulkPriceAdjust}
        orders={orders}
        orderPagination={orderPagination}
        ordersLoading={ordersLoading}
        onLoadOrders={handleLoadOrders}
        onUpdateOrderStatus={handleUpdateOrderStatus}
        onUpdateOrderTracking={handleUpdateOrderTracking}
        onAddOrderInternalNote={handleAddOrderInternalNote}
        onCreateManualOrder={handleCreateManualOrder}
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
        openCart={() => setIsCartOpen(true)}
        cartCount={totalCartCount}
        categories={categories}
        selectedCategory={selectedCategory}
        onSelectCategory={(cat) => setSelectedCategory(cat)}
      />

      {/* Main Storefront Body: Products Section as requested */}
      <main className="flex-1">
        {/* Store Hero Banner */}
        <PharmacyHero
          selectedCategory={selectedCategory}
          categories={categories}
          onSelectCategory={(cat) => setSelectedCategory(cat)}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
        />

        {/* Store Catalog & Filterable Products */}
        <CategoriesAndProducts
          catalogItems={catalogItems}
          categories={categories}
          onSelectItem={handleAddToCart}
          selectedCategory={selectedCategory}
          onSelectCategory={(cat) => setSelectedCategory(cat)}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
        />
        {catalogError && (
          <p role="alert" className="mx-auto my-6 max-w-7xl rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            {catalogError} Products and checkout are unavailable until the live catalog service is restored.
          </p>
        )}

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
              <span className="font-bold text-lg text-white block">Ambients Pharmacy &amp; Wellness</span>
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
            </div>
          </div>

          <div className="flex flex-col items-center justify-between gap-2 border-t border-white/15 pt-6 text-[11px] text-blue-100/70 sm:flex-row">
            <span>© 2026 Ambients. All rights reserved.</span>
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
