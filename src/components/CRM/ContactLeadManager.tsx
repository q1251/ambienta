import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Bell,
  Calendar,
  Check,
  CheckSquare,
  Clock,
  Copy,
  DollarSign,
  Download,
  Filter,
  Kanban,
  LayoutGrid,
  Mail,
  MessageSquare,
  Package,
  Pencil,
  Phone,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Square,
  Table as TableIcon,
  TrendingUp,
  Upload,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  ContactLead,
  ContactLeadInput,
  ContactLeadUpdate,
  LeadActivityInput,
  LeadAssignmentResult,
  LeadContactCompleteness,
  LeadHistoryImportInput,
  LeadProfile,
  LeadSourceRecordImportInput,
  LeadStatus,
  OnlineOrder,
} from '../../types/pharmacy';
import {
  generateSampleCsv,
  classifyLeadContact,
  calculateLeadProfileCompleteness,
  isValidLeadEmail,
  parseLeadsCsv,
  sortContactLeads,
  LeadSortField,
} from '../../utils/pharmacyLogic';
import { CountryFlag, CountrySelect, PhoneCountryInput } from './PhoneCountryInput';
import { getLeadCountryCode, getLeadCountryLabel } from '../../utils/countryOptions';

type NewLead = ContactLeadInput;

interface ContactLeadManagerProps {
  role?: 'admin' | 'operator';
  canSendEmail?: boolean;
  canAddContacts?: boolean;
  canImportContacts?: boolean;
  canExportContacts?: boolean;
  canViewNewLeads?: boolean;
  leads: ContactLead[];
  dataError?: string;
  onOpenEmailCampaigns?: () => void;
  onSaveLeads: (
    leads: NewLead[],
    historicalOrders?: LeadHistoryImportInput[],
    sourceRecords?: LeadSourceRecordImportInput[],
  ) => Promise<void>;
  onLoadLeadProfile?: (leadId: number) => Promise<LeadProfile>;
  onUpdateLead?: (leadId: number, update: ContactLeadUpdate) => Promise<ContactLead>;
  onAssignLeads: (leadIds: number[], mode: 'manual' | 'least_loaded', assignedStaffId?: number | null) => Promise<LeadAssignmentResult>;
  onAddLeadActivity?: (leadId: number, activity: LeadActivityInput) => Promise<LeadProfile['activities'][number]>;
}

interface AgentOption {
  id: number;
  email: string;
  display_name: string;
  is_active: boolean;
  permissions: string[];
  assigned_lead_count?: number;
}

interface LeadAssignmentNotification {
  id: number;
  leadId: number;
  firstName: string;
  lastName: string;
  status: LeadStatus;
  assignedByName: string;
  assignedAt: string;
}

const STAGES: Array<{ id: LeadStatus; label: string; bg: string; text: string; border: string }> = [
  { id: 'New', label: 'New', bg: 'bg-blue-50', text: 'text-blue-800', border: 'border-blue-200' },
  { id: 'Cold', label: 'Cold', bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' },
  { id: 'Contacted', label: 'Contacted', bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-200' },
  { id: 'Qualified', label: 'Qualified', bg: 'bg-purple-50', text: 'text-purple-800', border: 'border-purple-200' },
  { id: 'Customer', label: 'Customer', bg: 'bg-blue-50', text: 'text-blue-800', border: 'border-blue-200' },
  { id: 'Inactive', label: 'Inactive', bg: 'bg-zinc-100', text: 'text-zinc-600', border: 'border-zinc-200' },
];

const LEAD_PAGE_SIZE_OPTIONS = [25, 50, 100, 250] as const;

const CONTACT_TYPE_LABELS: Record<LeadContactCompleteness, string> = {
  full_contact: 'Full details',
  email_phone: 'Email + phone',
  email_name: 'Email + name',
  email_only: 'Email only',
  phone_name: 'Phone + name',
  phone_only: 'Phone only',
  address_only: 'Address only',
  incomplete: 'Incomplete',
};

const leadContactType = (lead: ContactLead): LeadContactCompleteness =>
  lead.contactCompleteness ?? classifyLeadContact(lead);

const leadDisplayName = (lead: Pick<ContactLead, 'firstName' | 'lastName' | 'email' | 'address' | 'postalCode' | 'contactCompleteness'>): string => {
  const name = `${lead.firstName} ${lead.lastName}`.trim();
  return name || (lead.email
    ? 'Email-only contact'
    : lead.address || lead.postalCode || lead.contactCompleteness === 'address_only'
      ? 'Address-only contact'
      : 'Phone-only contact');
};

export const ContactLeadManager: React.FC<ContactLeadManagerProps> = ({
  role,
  canSendEmail = false,
  canAddContacts = false,
  canImportContacts = false,
  canExportContacts = false,
  canViewNewLeads = false,
  leads,
  dataError,
  onOpenEmailCampaigns,
  onSaveLeads,
  onLoadLeadProfile,
  onUpdateLead,
  onAssignLeads,
  onAddLeadActivity,
}) => {
  // View mode: 'table' vs 'kanban'
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');

  // Modals & form state
  const [mode, setMode] = useState<'csv' | 'manual' | null>(null);
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<NewLead[]>([]);
  const [historyPreview, setHistoryPreview] = useState<LeadHistoryImportInput[]>([]);
  const [sourceRecordsPreview, setSourceRecordsPreview] = useState<LeadSourceRecordImportInput[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [requestError, setRequestError] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');

  // Manual entry fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('');
  const [marketingConsent, setMarketingConsent] = useState(false);

  // Profile details editing
  const [profileFirstName, setProfileFirstName] = useState('');
  const [profileLastName, setProfileLastName] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileCountry, setProfileCountry] = useState('');
  const [profileAddress, setProfileAddress] = useState('');
  const [profilePostalCode, setProfilePostalCode] = useState('');
  const [editingLead, setEditingLead] = useState<ContactLead | null>(null);
  const [editLeadError, setEditLeadError] = useState('');
  const [editLeadSaving, setEditLeadSaving] = useState(false);

  // Filters & Search
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<'All' | LeadStatus>('All');
  const [countryFilter, setCountryFilter] = useState('All');
  const [contactTypeFilter, setContactTypeFilter] = useState<'All' | LeadContactCompleteness>('All');
  const [leadTab, setLeadTab] = useState<'all' | 'unassigned' | 'uncalled_repeat_buyers' | 'opted_in' | 'needs_followup'>('all');
  const [pageSize, setPageSize] = useState<number>(50);
  const [tableFilters, setTableFilters] = useState({
    name: '',
    email: '',
    details: '',
    phone: '',
    address: '',
    country: 'All',
    status: 'All' as 'All' | LeadStatus,
    orders: '',
    lastOrder: '',
    agent: 'All',
  });
  const [leadPage, setLeadPage] = useState(1);
  const [sortField, setSortField] = useState<LeadSortField>('completeness');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const handleToggleSort = (field: LeadSortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder(field === 'name' || field === 'country' ? 'asc' : 'desc');
    }
  };

  const updateTableFilter = <K extends keyof typeof tableFilters>(field: K, value: (typeof tableFilters)[K]) => {
    setTableFilters((current) => ({ ...current, [field]: value }));
    setLeadPage(1);
  };

  const clearTableFilters = () => {
    setTableFilters({
      name: '',
      email: '',
      details: '',
      phone: '',
      address: '',
      country: 'All',
      status: 'All',
      orders: '',
      lastOrder: '',
      agent: 'All',
    });
    setLeadPage(1);
  };

  // Multi-select batch actions
  const [selectedLeadIds, setSelectedLeadIds] = useState<number[]>([]);
  const [batchUpdating, setBatchUpdating] = useState(false);

  // Profile drawer
  const [profile, setProfile] = useState<LeadProfile | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(() => {
    const value = Number(new URLSearchParams(window.location.search).get('leadId'));
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  });
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [assignmentNotifications, setAssignmentNotifications] = useState<LeadAssignmentNotification[]>([]);
  const [profileSaving, setProfileSaving] = useState(false);
  const [contactDetailsEditing, setContactDetailsEditing] = useState(false);
  const [profileActiveTab, setProfileActiveTab] = useState<'overview' | 'orders' | 'timeline' | 'source'>('overview');

  // Activities & Comments
  const [activityNote, setActivityNote] = useState('');
  const [activitySaving, setActivitySaving] = useState(false);

  // Email Composer
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailComposerOpen, setEmailComposerOpen] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [copiedField, setCopiedField] = useState('');

  const profileRequestId = useRef(0);
  const initialProfileLoadStarted = useRef(false);
  const isSuperadmin = role === 'admin';
  const canAddContactsForRole = isSuperadmin || canAddContacts;
  const canImportContactsForRole = isSuperadmin || canImportContacts;
  const canExportContactsForRole = isSuperadmin || canExportContacts;
  const canEditSelectedLead = isSuperadmin || profile?.lead.assignedStaffId != null;

  // Load staff agents for assignment
  useEffect(() => {
    if (!isSuperadmin) return;
    let active = true;
    fetch('/api/data.php?resource=staff', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        const result = (await response.json()) as { staff?: AgentOption[]; message?: string };
        if (!response.ok || !Array.isArray(result.staff)) {
          throw new Error(result.message || 'Agent accounts could not be loaded for lead assignment.');
        }
        if (active) {
          setAgents(result.staff
            .filter((agent) => agent.is_active && agent.permissions.includes('leads'))
            .sort((left, right) =>
              (left.assigned_lead_count ?? 0) - (right.assigned_lead_count ?? 0)
              || left.display_name.localeCompare(right.display_name)
            ));
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setRequestError(error instanceof Error ? error.message : 'Agent accounts could not be loaded.');
        }
      });
    return () => {
      active = false;
    };
  }, [isSuperadmin]);

  useEffect(() => {
    if (role !== 'operator') return;
    let active = true;
    const loadNotifications = async () => {
      try {
        const response = await fetch('/api/data.php?resource=lead-assignment-notifications', {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        });
        const result = await response.json() as { notifications?: LeadAssignmentNotification[]; message?: string };
        if (!response.ok || !Array.isArray(result.notifications)) {
          throw new Error(result.message || 'Lead assignment notifications could not be loaded.');
        }
        if (active) setAssignmentNotifications(result.notifications);
      } catch (error) {
        if (active) {
          setRequestError(error instanceof Error ? error.message : 'Lead assignment notifications could not be loaded.');
        }
      }
    };
    void loadNotifications();
    const timer = window.setInterval(() => void loadNotifications(), 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [role]);

  // Keyboard handlers for modals
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (mode && !saving) setMode(null);
        if (editingLead && !editLeadSaving) setEditingLead(null);
        if (emailComposerOpen && !emailSending) setEmailComposerOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, saving, editingLead, editLeadSaving, emailComposerOpen, emailSending]);

  // Computed summary metrics
  const totalLeadsCount = leads.length;
  const unassignedLeadCount = leads.filter((lead) => lead.assignedStaffId == null).length;
  const customersCount = leads.filter((l) => (l.orderCount ?? 0) > 0 || l.status === 'Customer').length;
  const eligibleMarketingCount = leads.filter((l) => l.marketingConsent).length;
  const needsFollowupCount = leads.filter((l) => ['Cold', 'Contacted', 'Qualified'].includes(l.status)).length;
  const contactTypeCounts = useMemo(
    () => leads.reduce<Record<LeadContactCompleteness, number>>((counts, lead) => {
      counts[leadContactType(lead)] += 1;
      return counts;
    }, {
      full_contact: 0,
      email_phone: 0,
      email_name: 0,
      email_only: 0,
      phone_name: 0,
      phone_only: 0,
      address_only: 0,
      incomplete: 0,
    }),
    [leads],
  );
  const previewContactTypeCounts = useMemo(
    () => preview.reduce<Record<LeadContactCompleteness, number>>((counts, lead) => {
      counts[classifyLeadContact(lead)] += 1;
      return counts;
    }, {
      full_contact: 0,
      email_phone: 0,
      email_name: 0,
      email_only: 0,
      phone_name: 0,
      phone_only: 0,
      address_only: 0,
      incomplete: 0,
    }),
    [preview],
  );

  const isUncalledRepeatBuyer = (lead: ContactLead) =>
    (lead.callCount ?? 0) === 0 && (lead.activeOrderCount ?? 0) >= 2;

  // Unique countries list
  const availableCountries = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => {
      const c = getLeadCountryLabel(l.country || '', l.phone);
      if (c && c !== 'Not specified') set.add(c);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [leads]);

  // Filtered Leads
  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      const leadCountry = getLeadCountryLabel(lead.country || '', lead.phone);
      const matchesStage = stageFilter === 'All' || lead.status === stageFilter;
      const matchesCountry = countryFilter === 'All' || leadCountry === countryFilter;
      const matchesContactType = contactTypeFilter === 'All' || leadContactType(lead) === contactTypeFilter;
      const query = search.trim().toLowerCase();
      const matchesSearch =
        !query ||
        `${lead.firstName} ${lead.lastName} ${lead.email} ${lead.phone} ${leadCountry}`.toLowerCase().includes(query);

      let matchesTab = true;
      if (leadTab === 'uncalled_repeat_buyers') {
        matchesTab = isUncalledRepeatBuyer(lead);
      } else if (leadTab === 'opted_in') {
        matchesTab = lead.marketingConsent;
      } else if (leadTab === 'needs_followup') {
        matchesTab = ['Cold', 'Contacted', 'Qualified'].includes(lead.status);
      } else if (leadTab === 'unassigned') {
        matchesTab = lead.assignedStaffId == null;
      }

      return matchesStage && matchesCountry && matchesContactType && matchesSearch && matchesTab;
    });
  }, [leads, stageFilter, countryFilter, contactTypeFilter, search, leadTab]);

  const tableFilteredLeads = useMemo(() => {
    const includes = (value: string | undefined, query: string) =>
      !query.trim() || (value || '').toLowerCase().includes(query.trim().toLowerCase());
    return filteredLeads.filter((lead) => {
      const countryLabel = getLeadCountryLabel(lead.country || '', lead.phone);
      const orderCount = leadTab === 'uncalled_repeat_buyers' ? lead.activeOrderCount || 0 : lead.orderCount || 0;
      const detailsScore = lead.profileCompletenessScore ?? calculateLeadProfileCompleteness(lead);
      const lastOrderTimestamp = lead.lastOrderAt ? Date.parse(lead.lastOrderAt) : Number.NaN;
      const lastOrder = Number.isFinite(lastOrderTimestamp) ? new Date(lastOrderTimestamp).toISOString().slice(0, 10) : '';
      return includes(`${lead.firstName} ${lead.lastName}`.trim(), tableFilters.name)
        && includes(lead.email, tableFilters.email)
        && (!tableFilters.details || detailsScore === Number(tableFilters.details))
        && includes(lead.phone, tableFilters.phone)
        && includes(`${lead.address || ''} ${lead.postalCode || ''}`, tableFilters.address)
        && (tableFilters.country === 'All' || countryLabel === tableFilters.country)
        && (tableFilters.status === 'All' || lead.status === tableFilters.status)
        && (!tableFilters.orders || orderCount === Number(tableFilters.orders))
        && (!tableFilters.lastOrder || lastOrder === tableFilters.lastOrder)
        && (tableFilters.agent === 'All'
          || (tableFilters.agent === 'unassigned'
            ? lead.assignedStaffId == null
            : String(lead.assignedStaffId ?? '') === tableFilters.agent));
    });
  }, [filteredLeads, tableFilters, leadTab]);

  const sortedLeads = useMemo(() => {
    return sortContactLeads(tableFilteredLeads, sortField, sortOrder);
  }, [tableFilteredLeads, sortField, sortOrder]);

  const pageCount = Math.max(1, Math.ceil(sortedLeads.length / pageSize));
  const currentPage = Math.min(leadPage, pageCount);
  const visibleLeads = sortedLeads.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const hasTableFilters = Object.entries(tableFilters).some(([key, value]) => value !== (key === 'status' || key === 'country' || key === 'agent' ? 'All' : ''));
  const maxProfileCompletenessScore = leads.reduce(
    (max, lead) => Math.max(max, lead.profileCompletenessMaxScore ?? 7),
    0,
  );

  // Multi-select helpers
  const isAllVisibleSelected = visibleLeads.length > 0 && visibleLeads.every((l) => selectedLeadIds.includes(l.id));

  const toggleSelectAll = () => {
    if (isAllVisibleSelected) {
      setSelectedLeadIds((prev) => prev.filter((id) => !visibleLeads.some((l) => l.id === id)));
    } else {
      const newIds = new Set([...selectedLeadIds, ...visibleLeads.map((l) => l.id)]);
      setSelectedLeadIds(Array.from(newIds));
    }
  };

  const toggleSelectOne = (id: number) => {
    setSelectedLeadIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const refreshAgentCounts = (assignments: LeadAssignmentResult['assignments']) => {
    const leadsById = new Map(leads.map((lead) => [lead.id, lead]));
    setAgents((current) => current.map((agent) => {
      let assignedLeadCount = agent.assigned_lead_count ?? 0;
      for (const assignment of assignments) {
        const previousLead = leadsById.get(assignment.leadId);
        const previousAgentId = previousLead?.assignedStaffId ?? null;
        if (previousAgentId === agent.id && previousAgentId !== assignment.assignedStaffId) assignedLeadCount--;
        if (assignment.assignedStaffId === agent.id && previousAgentId !== assignment.assignedStaffId) assignedLeadCount++;
      }
      return { ...agent, assigned_lead_count: Math.max(0, assignedLeadCount) };
    }).sort((left, right) =>
      (left.assigned_lead_count ?? 0) - (right.assigned_lead_count ?? 0)
      || left.display_name.localeCompare(right.display_name)
    ));
  };

  const handleBatchStageUpdate = async (newStage: LeadStatus) => {
    if (!onUpdateLead || !selectedLeadIds.length) return;
    setBatchUpdating(true);
    setRequestError('');
    try {
      await Promise.all(selectedLeadIds.map((id) => onUpdateLead(id, { status: newStage })));
      setSuccess(`Updated ${selectedLeadIds.length} contact${selectedLeadIds.length === 1 ? '' : 's'} to ${newStage}.`);
      setSelectedLeadIds([]);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Batch stage update failed.');
    } finally {
      setBatchUpdating(false);
    }
  };

  const handleBatchAgentAssign = async (agentIdStr: string) => {
    if (!selectedLeadIds.length) return;
    setBatchUpdating(true);
    setRequestError('');
    try {
      const autoAssign = agentIdStr === 'least_loaded';
      const assignedStaffId = agentIdStr ? Number(agentIdStr) : null;
      const result = await onAssignLeads(
        selectedLeadIds,
        autoAssign ? 'least_loaded' : 'manual',
        autoAssign ? undefined : assignedStaffId,
      );
      refreshAgentCounts(result.assignments);
      setSuccess(autoAssign
        ? `Assigned ${result.assignedCount} selected lead${result.assignedCount === 1 ? '' : 's'} to the least-loaded eligible agent${result.assignedCount === 1 ? '' : 's'}.`
        : `Updated assignment for ${result.assignedCount} selected lead${result.assignedCount === 1 ? '' : 's'}.`);
      setSelectedLeadIds([]);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Batch agent assignment failed.');
    } finally {
      setBatchUpdating(false);
    }
  };

  const handleAutoAssignQueue = async () => {
    const unassignedIds = tableFilteredLeads.filter((lead) => lead.assignedStaffId == null).map((lead) => lead.id);
    if (!unassignedIds.length) return;
    setBatchUpdating(true);
    setRequestError('');
    setSuccess('');
    try {
      const result = await onAssignLeads(unassignedIds, 'least_loaded');
      refreshAgentCounts(result.assignments);
      setSuccess(`Assigned ${result.assignedCount} of ${unassignedIds.length} unassigned leads to the least-loaded eligible agents.`);
      setSelectedLeadIds([]);
      setLeadPage(1);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Unassigned leads could not be distributed.');
    } finally {
      setBatchUpdating(false);
    }
  };

  const handleSingleAgentAssign = async (leadId: number, value: string) => {
    if (!onUpdateLead) return;
    setRequestError('');
    try {
      const updatedLead = await onUpdateLead(leadId, { assignedStaffId: value ? Number(value) : null });
      refreshAgentCounts([{
        leadId,
        assignedStaffId: updatedLead.assignedStaffId ?? null,
        assignedStaffName: updatedLead.assignedStaffName ?? null,
      }]);
      setSuccess('Lead assignment updated.');
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Lead assignment could not be updated.');
    }
  };

  // CSV parser
  const parse = (value: string) => {
    setCsv(value);
    const result = parseLeadsCsv(value);
    setPreview(result.leads);
    setHistoryPreview(result.historicalOrders);
    setSourceRecordsPreview(result.sourceRecords);
    setErrors(result.errors);
    setRequestError('');
  };

  const save = async (
    rows: NewLead[],
    historicalOrders: LeadHistoryImportInput[] = [],
    sourceRecords: LeadSourceRecordImportInput[] = [],
  ) => {
    const hasImportRows = rows.some((row) => row.leadSource === 'CSV Upload');
    const hasManualRows = rows.some((row) => row.leadSource !== 'CSV Upload');
    if ((hasImportRows && !canImportContactsForRole) || (hasManualRows && !canAddContactsForRole)) {
      setRequestError(hasImportRows && !canImportContactsForRole
        ? 'You do not have permission to import contacts.'
        : 'You do not have permission to add contacts.');
      return;
    }
    setSaving(true);
    setRequestError('');
    setSuccess('');
    try {
      await onSaveLeads(rows, historicalOrders, isSuperadmin ? sourceRecords : []);
      setSuccess(
        `Saved ${rows.length} contact lead${rows.length === 1 ? '' : 's'}`
        + `${historicalOrders.length ? ` and ${historicalOrders.length} historical order record${historicalOrders.length === 1 ? '' : 's'}` : ''}`
        + `${isSuperadmin && sourceRecords.length ? ` and ${sourceRecords.length} source detail record${sourceRecords.length === 1 ? '' : 's'}` : ''}.`,
      );
      setPreview([]);
      setHistoryPreview([]);
      setSourceRecordsPreview([]);
      setCsv('');
      setFirstName('');
      setLastName('');
      setEmail('');
      setPhone('');
      setCountry('');
      setMarketingConsent(false);
      setMode(null);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Unable to save contact leads.');
    } finally {
      setSaving(false);
    }
  };

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => parse(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => setRequestError('The selected CSV file could not be read.');
    reader.readAsText(file);
    event.target.value = '';
  };

  const downloadSample = () => {
    const url = URL.createObjectURL(new Blob([generateSampleCsv()], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ambients-contact-leads.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadContacts = (contactsToExport = filteredLeads) => {
    if (!canExportContactsForRole) {
      setRequestError('You do not have permission to export contacts.');
      return;
    }
    const escapeCsv = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const rows = [
      ['first_name', 'last_name', 'email', 'phone', 'address', 'postal_code', 'country', 'lead_source', 'status', 'marketing_consent', 'created_at'],
      ...contactsToExport.map((lead) => [
        lead.firstName,
        lead.lastName,
        lead.email,
        lead.phone,
        lead.address || '',
        lead.postalCode || '',
        getLeadCountryLabel(lead.country || '', lead.phone),
        lead.leadSource,
        lead.status,
        lead.marketingConsent ? 'yes' : 'no',
        lead.createdAt,
      ]),
    ];
    const contents = rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `ambients-contacts-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleManualSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const emailValue = email.trim();
    const phoneValue = phone.trim();
    if (
      (emailValue && !isValidLeadEmail(emailValue))
      || (!emailValue && phoneValue.replace(/\D/g, '').length < 7)
    ) {
      setRequestError('Enter a valid email address or a phone number with at least seven digits.');
      return;
    }
    void save([
      {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: emailValue,
        phone: phoneValue,
        country: getLeadCountryLabel(country, phoneValue),
        leadSource: 'Manual Entry',
        status: 'Cold',
        marketingConsent: Boolean(emailValue && marketingConsent),
      },
    ]);
  };

  // Open single lead profile
  const openProfile = async (lead: ContactLead, beginEditing = false) => {
    if (!onLoadLeadProfile) return;
    const requestId = ++profileRequestId.current;
    const url = new URL(window.location.href);
    url.searchParams.set('leadId', String(lead.id));
    window.history.replaceState(window.history.state, '', url);
    setSelectedLeadId(lead.id);
    setProfile(null);
    setProfileError('');
    setProfileSaving(false);
    setContactDetailsEditing(beginEditing);
    setActivitySaving(false);
    setActivityNote('');
    setEmailSubject('');
    setEmailBody('');
    setProfileLoading(true);
    setProfileActiveTab('overview');

    try {
      const loadedProfile = await onLoadLeadProfile(lead.id);
      if (requestId === profileRequestId.current) {
        setProfile(loadedProfile);
        setProfileFirstName(loadedProfile.lead.firstName);
        setProfileLastName(loadedProfile.lead.lastName);
        setProfileEmail(loadedProfile.lead.email);
        setProfilePhone(loadedProfile.lead.phone);
        setProfileCountry(getLeadCountryLabel(loadedProfile.lead.country || '', loadedProfile.lead.phone));
        setProfileAddress(loadedProfile.lead.address || '');
        setProfilePostalCode(loadedProfile.lead.postalCode || '');
      }
    } catch (error) {
      if (requestId === profileRequestId.current) {
        setProfileError(error instanceof Error ? error.message : 'The contact profile could not be loaded.');
      }
    } finally {
      if (requestId === profileRequestId.current) setProfileLoading(false);
    }
  };

  useEffect(() => {
    if (initialProfileLoadStarted.current || selectedLeadId === null || profile || profileLoading || !onLoadLeadProfile) {
      return;
    }
    const lead = leads.find((item) => item.id === selectedLeadId);
    if (!lead) return;
    initialProfileLoadStarted.current = true;
    void openProfile(lead);
  }, [selectedLeadId, profile, profileLoading, leads, onLoadLeadProfile]);

  const closeProfile = () => {
    profileRequestId.current += 1;
    const url = new URL(window.location.href);
    url.searchParams.delete('leadId');
    window.history.replaceState(window.history.state, '', url);
    setSelectedLeadId(null);
    setProfile(null);
    setProfileError('');
    setContactDetailsEditing(false);
    setProfileLoading(false);
    setProfileSaving(false);
    setActivitySaving(false);
  };

  const acknowledgeAssignmentNotification = async (notificationId: number) => {
    try {
      const response = await fetch('/api/data.php?resource=lead-assignment-notifications', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ids: [notificationId] }),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) {
        throw new Error(result.message || 'The assignment notification could not be acknowledged.');
      }
      setAssignmentNotifications((current) => current.filter((notification) => notification.id !== notificationId));
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'The assignment notification could not be acknowledged.');
    }
  };

  const openAssignmentNotification = async (notification: LeadAssignmentNotification) => {
    await acknowledgeAssignmentNotification(notification.id);
    await openProfile({
      id: notification.leadId,
      firstName: notification.firstName,
      lastName: notification.lastName,
      email: '',
      phone: '',
      leadSource: 'Manual Entry',
      createdAt: notification.assignedAt,
      status: notification.status,
      marketingConsent: false,
    });
  };

  const updateProfile = async (update: ContactLeadUpdate): Promise<boolean> => {
    if (!profile || !canEditSelectedLead || !onUpdateLead) return false;
    const requestId = profileRequestId.current;
    const leadId = profile.lead.id;
    const previousAssignedStaffId = profile.lead.assignedStaffId ?? null;
    setProfileSaving(true);
    setProfileError('');
    try {
      const lead = await onUpdateLead(leadId, update);
      if (requestId !== profileRequestId.current) return false;
      setProfile((current) => (current?.lead.id === leadId ? { ...current, lead } : current));
      if (update.assignedStaffId !== undefined) {
        refreshAgentCounts([{
          leadId,
          assignedStaffId: lead.assignedStaffId ?? null,
          assignedStaffName: lead.assignedStaffName ?? null,
        }]);
      }
      if (update.firstName !== undefined) setProfileFirstName(lead.firstName);
      if (update.lastName !== undefined) setProfileLastName(lead.lastName);
      if (update.email !== undefined) setProfileEmail(lead.email);
      if (update.phone !== undefined) setProfilePhone(lead.phone);
      if (update.country !== undefined) setProfileCountry(getLeadCountryLabel(lead.country || '', lead.phone));
      if (update.address !== undefined) setProfileAddress(lead.address || '');
      if (update.postalCode !== undefined) setProfilePostalCode(lead.postalCode || '');

      if (onLoadLeadProfile) {
        try {
          const refreshed = await onLoadLeadProfile(lead.id);
          if (requestId === profileRequestId.current) setProfile(refreshed);
        } catch {
          // Keep current profile state
        }
      }
      return true;
    } catch (error) {
      if (requestId !== profileRequestId.current) return false;
      setProfileError(error instanceof Error ? error.message : 'The contact profile could not be updated.');
      return false;
    } finally {
      if (requestId === profileRequestId.current) setProfileSaving(false);
    }
  };

  const cancelContactDetailsEdit = () => {
    if (!profile) return;
    setProfileFirstName(profile.lead.firstName);
    setProfileLastName(profile.lead.lastName);
    setProfileEmail(profile.lead.email);
    setProfilePhone(profile.lead.phone);
    setProfileCountry(getLeadCountryLabel(profile.lead.country || '', profile.lead.phone));
    setProfileAddress(profile.lead.address || '');
    setProfilePostalCode(profile.lead.postalCode || '');
    setContactDetailsEditing(false);
  };

  const saveContactDetails = (event: React.FormEvent) => {
    event.preventDefault();
    void updateProfile({
      firstName: profileFirstName.trim(),
      lastName: profileLastName.trim(),
      email: profileEmail.trim(),
      phone: profilePhone.trim(),
      country: profileCountry.trim(),
      address: profileAddress.trim(),
      postalCode: profilePostalCode.trim(),
    }).then((saved) => {
      if (saved) setContactDetailsEditing(false);
    });
  };

  const openLeadEditor = (lead: ContactLead) => {
    setEditingLead(lead);
    setProfileFirstName(lead.firstName);
    setProfileLastName(lead.lastName);
    setProfileEmail(lead.email);
    setProfilePhone(lead.phone);
    setProfileCountry(getLeadCountryLabel(lead.country || '', lead.phone));
    setProfileAddress(lead.address || '');
    setProfilePostalCode(lead.postalCode || '');
    setEditLeadError('');
  };

  const saveLeadFromTable = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingLead || !onUpdateLead) return;
    setEditLeadSaving(true);
    setEditLeadError('');
    try {
      await onUpdateLead(editingLead.id, {
        firstName: profileFirstName.trim(),
        lastName: profileLastName.trim(),
        email: profileEmail.trim(),
        phone: profilePhone.trim(),
        country: profileCountry.trim(),
        address: profileAddress.trim(),
        postalCode: profilePostalCode.trim(),
      });
      setEditingLead(null);
      setSuccess('Lead contact details saved.');
    } catch (error) {
      setEditLeadError(error instanceof Error ? error.message : 'The contact details could not be saved.');
    } finally {
      setEditLeadSaving(false);
    }
  };

  const saveActivity = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile || !canEditSelectedLead || !onAddLeadActivity) return;
    const requestId = profileRequestId.current;
    const leadId = profile.lead.id;
    setActivitySaving(true);
    setProfileError('');
    try {
      const saved = await onAddLeadActivity(leadId, {
        type: 'note',
        note: activityNote.trim(),
      });
      if (requestId !== profileRequestId.current) return;
      setProfile((current) =>
        current?.lead.id === leadId ? { ...current, activities: [saved, ...current.activities] } : current
      );
      setActivityNote('');
    } catch (error) {
      if (requestId !== profileRequestId.current) return;
      setProfileError(error instanceof Error ? error.message : 'The activity could not be saved.');
    } finally {
      if (requestId === profileRequestId.current) setActivitySaving(false);
    }
  };

  const copyLeadValue = async (
    event: React.MouseEvent<HTMLButtonElement>,
    leadId: number,
    field: 'name' | 'email' | 'phone',
    value: string
  ) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(`${leadId}-${field}`);
      window.setTimeout(() => setCopiedField((current) => (current === `${leadId}-${field}` ? '' : current)), 1600);
    } catch (error) {
      setRequestError(error instanceof Error ? `Could not copy ${field}: ${error.message}` : `Could not copy ${field}.`);
    }
  };

  const copyButton = (lead: ContactLead, field: 'name' | 'email' | 'phone', value: string) => {
    const key = `${lead.id}-${field}`;
    const copied = copiedField === key;
    return (
      <button
        type="button"
        onClick={(event) => void copyLeadValue(event, lead.id, field, value)}
        aria-label={`${copied ? 'Copied' : 'Copy'} ${field} for ${lead.firstName} ${lead.lastName}`}
        title={copied ? 'Copied' : `Copy ${field}`}
        className="ml-1 inline-flex shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-blue-600" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    );
  };

  const sendLeadEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile || !canSendEmail) return;
    setEmailError('');
    setEmailSending(true);
    try {
      const response = await fetch('/api/data.php?resource=email-send', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: profile.lead.id,
          subject: emailSubject.trim(),
          body: emailBody.trim(),
        }),
      });
      const result = (await response.json()) as { sent?: boolean; message?: string };
      if (!response.ok || result.sent !== true) {
        throw new Error(result.message || 'The email could not be sent.');
      }
      setEmailComposerOpen(false);
      setEmailSubject('');
      setEmailBody('');
      setSuccess(result.message || 'Email sent successfully via Hostinger.');
    } catch (error) {
      setEmailError(error instanceof Error ? error.message : 'The email could not be sent.');
    } finally {
      setEmailSending(false);
    }
  };

  // Quick email templates
  const applyEmailTemplate = (templateType: 'welcome' | 'order_followup' | 'consult') => {
    if (!profile) return;
    const name = profile.lead.firstName || 'there';
    if (templateType === 'welcome') {
      setEmailSubject('Welcome to Ambients Pharmacy & Wellness');
      setEmailBody(
        `Hello ${name},\n\nThank you for connecting with Ambients Pharmacy & Wellness. Our clinical team is dedicated to supporting your health, sleep, and metabolic wellness goals.\n\nIf you have any questions about our formulas or current regimens, simply reply to this email.\n\nWarm regards,\nAmbients Clinical Care Team`
      );
    } else if (templateType === 'order_followup') {
      setEmailSubject('Checking in on your recent Ambients order');
      setEmailBody(
        `Dear ${name},\n\nWe wanted to confirm that your recent order arrived safely and ensure you have all dosage instructions.\n\nOur on-duty specialists are available if you need any adjustments or wellness guidance.\n\nBest regards,\nAmbients Support`
      );
    } else {
      setEmailSubject('Consultation follow-up from Ambients');
      setEmailBody(
        `Hi ${name},\n\nFollowing up on our recent conversation regarding your wellness regimen. Let us know if you would like to schedule time to review your health categories or product options.\n\nSincerely,\nAmbients Wellness Team`
      );
    }
  };

  // Profile financial calculations
  const totalCustomerSpend = useMemo(() => {
    if (!profile?.orders) return 0;
    return profile.orders
      .filter((o) => o.status !== 'Cancelled')
      .reduce((sum, o) => sum + (o.totalAmount || 0), 0);
  }, [profile?.orders]);

  const averageOrderValue = useMemo(() => {
    if (!profile?.orders || profile.orders.length === 0) return 0;
    const validOrders = profile.orders.filter((o) => o.status !== 'Cancelled');
    if (!validOrders.length) return 0;
    return totalCustomerSpend / validOrders.length;
  }, [profile?.orders, totalCustomerSpend]);

  // Combined chronological timeline
  const combinedTimeline = useMemo(() => {
    if (!profile) return [];
    type TimelineItem =
      | { type: 'activity'; date: string; data: LeadProfile['activities'][number] }
      | { type: 'order'; date: string; data: OnlineOrder };

    const items: TimelineItem[] = [];

    (profile.activities || []).forEach((act) => {
      items.push({ type: 'activity', date: act.createdAt, data: act });
    });

    (profile.orders || []).forEach((ord) => {
      items.push({ type: 'order', date: ord.placedAt || '2026-11-01', data: ord });
    });

    return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [profile]);

  // ----------------------------------------------------
  // RENDER: SINGLE LEAD PROFILE VIEW
  // ----------------------------------------------------
  if (selectedLeadId !== null) {
    const selectedLead = leads.find((lead) => lead.id === selectedLeadId);
    const leadStageObj = STAGES.find((s) => s.id === (profile?.lead.status || selectedLead?.status)) || STAGES[0];

    return (
      <section className="space-y-6">
        {/* Navigation & Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={closeProfile}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" /> Back to contacts
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!canEditSelectedLead || !canSendEmail || !profile?.lead.email}
              title={!profile?.lead.email ? 'This contact has no email address.' : undefined}
              onClick={() => {
                setEmailError('');
                setEmailComposerOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-[#1d4ed8] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1e40af] disabled:opacity-50"
            >
              <Mail className="h-4 w-4" /> Compose email
            </button>
          </div>
        </div>

        {/* Profile Header & Financial KPI Banner */}
        <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="flex items-start gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-xl font-bold uppercase text-blue-800">
                {(profile?.lead.firstName || selectedLead?.firstName || 'C')[0]}
                {(profile?.lead.lastName || selectedLead?.lastName || '')[0]}
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-2xl font-bold text-slate-900">
                    {profile
                      ? leadDisplayName(profile.lead)
                      : selectedLead
                      ? leadDisplayName(selectedLead)
                      : 'Lead profile'}
                  </h1>
                  <span
                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${leadStageObj.bg} ${leadStageObj.text} border ${leadStageObj.border}`}
                  >
                    {profile?.lead.status || selectedLead?.status}
                  </span>
                  {profile?.lead.marketingConsent && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                      <Check className="h-3 w-3" /> Opted in
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
                  {(profile?.lead.email || selectedLead?.email) && (
                    <span className="font-mono text-slate-700">{profile?.lead.email || selectedLead?.email}</span>
                  )}
                  {profile?.lead.phone && <span>· {profile.lead.phone}</span>}
                  <span>· {getLeadCountryLabel(profile?.lead.country || '', profile?.lead.phone || '')}</span>
                  <span>· Source: {profile?.lead.leadSource || selectedLead?.leadSource}</span>
                </div>
              </div>
            </div>

            {/* Quick KPI stats */}
            <div className="flex flex-wrap gap-3">
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Lifetime Spend</p>
                <p className="mt-0.5 text-lg font-bold text-slate-900">${totalCustomerSpend.toFixed(2)}</p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Orders</p>
                <p className="mt-0.5 text-lg font-bold text-slate-900">{profile?.orders.length ?? selectedLead?.orderCount ?? 0}</p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Avg. Order Value</p>
                <p className="mt-0.5 text-lg font-bold text-slate-900">${averageOrderValue.toFixed(2)}</p>
              </div>
            </div>
          </div>

          {/* Profile Navigation Tabs */}
          <div className="mt-6 flex gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={() => setProfileActiveTab('overview')}
              className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                profileActiveTab === 'overview'
                  ? 'bg-blue-50 text-blue-800'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              Contact & Notes
            </button>
            <button
              type="button"
              onClick={() => setProfileActiveTab('orders')}
              className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                profileActiveTab === 'orders'
                  ? 'bg-blue-50 text-blue-800'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              Orders ({profile?.orders.length ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setProfileActiveTab('timeline')}
              className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                profileActiveTab === 'timeline'
                  ? 'bg-blue-50 text-blue-800'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              Unified Timeline ({combinedTimeline.length})
            </button>
            {isSuperadmin && (
              <button
                type="button"
                onClick={() => setProfileActiveTab('source')}
                className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                  profileActiveTab === 'source'
                    ? 'bg-blue-50 text-blue-800'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                Source details ({profile?.sourceRecords.length ?? 0})
              </button>
            )}
          </div>
        </header>

        {profileLoading && (
          <p role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm font-medium text-blue-900">
            Loading contact profile, orders, and interaction history…
          </p>
        )}

        {profileError && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            <p>{profileError}</p>
            {selectedLead && (
              <button
                type="button"
                onClick={() => void openProfile(selectedLead)}
                className="mt-2 font-semibold underline"
              >
                Retry
              </button>
            )}
          </div>
        )}

        {profile && (
          <>
            {/* TAB 1: OVERVIEW & NOTES */}
            {profileActiveTab === 'overview' && (
              <div className="grid gap-6 lg:grid-cols-3">
                {/* Left 2 Cols: Contact info & Activity Notes */}
                <div className="space-y-6 lg:col-span-2">
                  <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h2 className="text-base font-bold text-slate-900">Contact details</h2>
                      {isSuperadmin && (
                        <button
                          type="button"
                          onClick={() =>
                            contactDetailsEditing ? cancelContactDetailsEdit() : setContactDetailsEditing(true)
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          {contactDetailsEditing ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                          {contactDetailsEditing ? 'Cancel' : 'Edit details'}
                        </button>
                      )}
                    </div>

                    {!contactDetailsEditing ? (
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Email Address</p>
                          <div className="mt-1 flex items-center justify-between">
                            <span className="truncate text-sm font-semibold text-slate-900">
                              {profile.lead.email || 'Not provided'}
                            </span>
                            {profile.lead.email && copyButton(profile.lead, 'email', profile.lead.email)}
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Phone Number</p>
                          <div className="mt-1 flex items-center justify-between">
                            <span className="truncate text-sm font-semibold text-slate-900">{profile.lead.phone || 'Not provided'}</span>
                            {profile.lead.phone && copyButton(profile.lead, 'phone', profile.lead.phone)}
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Country / Region</p>
                          <div className="mt-1 flex items-center gap-2">
                            <CountryFlag countryCode={getLeadCountryCode(profile.lead.country ?? '', profile.lead.phone)} />
                            <span className="text-sm font-semibold text-slate-900">{getLeadCountryLabel(profile.lead.country || '', profile.lead.phone)}</span>
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Acquisition Source</p>
                          <p className="mt-1 text-sm font-semibold text-slate-900">{profile.lead.leadSource}</p>
                        </div>
                        {(profile.lead.address || profile.lead.postalCode) && (
                          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5 sm:col-span-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Address & Postal Code</p>
                            <p className="mt-1 whitespace-pre-wrap text-sm font-semibold text-slate-900">
                              {[profile.lead.address, profile.lead.postalCode && `Postal code ${profile.lead.postalCode}`].filter(Boolean).join('\n') || 'No address recorded'}
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <form onSubmit={saveContactDetails} className="mt-4 grid gap-4 sm:grid-cols-2">
                        <label className="text-xs font-semibold text-slate-700">
                          First name
                          <input
                            maxLength={100}
                            value={profileFirstName}
                            onChange={(e) => setProfileFirstName(e.target.value)}
                            className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="text-xs font-semibold text-slate-700">
                          Last name
                          <input
                            maxLength={100}
                            value={profileLastName}
                            onChange={(e) => setProfileLastName(e.target.value)}
                            className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="text-xs font-semibold text-slate-700">
                          Email
                          <input
                            type="email"
                            maxLength={254}
                            value={profileEmail}
                            onChange={(e) => setProfileEmail(e.target.value)}
                            className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="text-xs font-semibold text-slate-700">
                          Phone
                          <span className="mt-1 block">
                            <PhoneCountryInput value={profilePhone} onChange={setProfilePhone} disabled={profileSaving} />
                          </span>
                        </label>
                        <label className="text-xs font-semibold text-slate-700 sm:col-span-2">
                          Country
                          <span className="mt-1 block">
                            <CountrySelect value={profileCountry} onChange={setProfileCountry} disabled={profileSaving} />
                          </span>
                        </label>
                        <label className="text-xs font-semibold text-slate-700 sm:col-span-2">
                          Address
                          <textarea
                            maxLength={500}
                            rows={2}
                            value={profileAddress}
                            onChange={(e) => setProfileAddress(e.target.value)}
                            className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="text-xs font-semibold text-slate-700">
                          Postal code
                          <input
                            maxLength={24}
                            value={profilePostalCode}
                            onChange={(e) => setProfilePostalCode(e.target.value)}
                            className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                          />
                        </label>
                        <div className="flex items-center gap-2 sm:col-span-2">
                          <button
                            type="submit"
                            disabled={profileSaving}
                            className="rounded-xl bg-[#1d4ed8] px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
                          >
                            {profileSaving ? 'Saving…' : 'Save changes'}
                          </button>
                          <button
                            type="button"
                            onClick={cancelContactDetailsEdit}
                            className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    )}
                  </section>

                  {/* Internal Staff Comments */}
                  <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h2 className="text-base font-bold text-slate-900">Internal notes & comments</h2>
                    <form onSubmit={(e) => void saveActivity(e)} className="mt-4 space-y-3">
                      <textarea
                        required
                        maxLength={2000}
                        rows={3}
                        value={activityNote}
                        onChange={(e) => setActivityNote(e.target.value)}
                        placeholder="Add an internal note or consult log for team reference…"
                        className="w-full rounded-xl border border-slate-300 p-3 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                      />
                      <button
                        type="submit"
                        disabled={activitySaving || !activityNote.trim()}
                        className="inline-flex items-center gap-2 rounded-xl bg-[#1d4ed8] px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        {activitySaving ? 'Saving note…' : 'Post comment'}
                      </button>
                    </form>

                    <div className="mt-6 space-y-3">
                      {profile.activities.filter((a) => a.type === 'note').length > 0 ? (
                        profile.activities
                          .filter((a) => a.type === 'note')
                          .map((note) => (
                            <div key={note.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
                              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                                <span className="font-semibold text-slate-700">{note.actorName || note.actorEmail || 'Staff'}</span>
                                <time>{new Date(note.createdAt).toLocaleString()}</time>
                              </div>
                              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{note.note}</p>
                            </div>
                          ))
                      ) : (
                        <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
                          No internal notes recorded yet.
                        </p>
                      )}
                    </div>
                  </section>
                </div>

                {/* Right Col: Stage management, Agent Assignment & Marketing Consent */}
                <div className="space-y-6">
                  <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">Lead Status & Stage</h2>
                    <div className="mt-4 space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-600">Current Pipeline Stage</label>
                        <select
                          disabled={!canEditSelectedLead || profileSaving}
                          value={profile.lead.status}
                          onChange={(e) => void updateProfile({ status: e.target.value as LeadStatus })}
                          className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
                        >
                          {STAGES.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      {isSuperadmin && (
                        <div>
                          <label className="block text-xs font-medium text-slate-600">Assigned Staff Agent</label>
                          <select
                            value={profile.lead.assignedStaffId ?? ''}
                            onChange={(e) =>
                              void updateProfile({ assignedStaffId: e.target.value ? Number(e.target.value) : null })
                            }
                            className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
                          >
                            <option value="">Unassigned</option>
                            {agents.map((agent) => (
                              <option key={agent.id} value={agent.id}>
                                {agent.display_name || agent.email}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5">
                        <label className="flex items-start gap-2 text-xs text-slate-700">
                          <input
                            type="checkbox"
                            disabled={!canEditSelectedLead || profileSaving}
                            checked={profile.lead.marketingConsent}
                            onChange={(e) => void updateProfile({ marketingConsent: e.target.checked })}
                            className="mt-0.5 rounded text-blue-800"
                          />
                          <span>
                            <strong className="block font-semibold text-slate-900">Marketing Consent</strong>
                            Explicit opt-in recorded for wellness updates and promotional correspondence.
                          </span>
                        </label>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            )}

            {/* TAB 2: ORDERS & TRACKING */}
            {profileActiveTab === 'orders' && (
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">Customer Purchase History</h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {profile.orders.length} order{profile.orders.length === 1 ? '' : 's'} linked to {profile.lead.email || 'this contact'}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-slate-900">
                    Total: ${totalCustomerSpend.toFixed(2)}
                  </span>
                </div>

                {profile.orders.length > 0 ? (
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Order #</th>
                          <th className="px-4 py-3">Placed</th>
                          <th className="px-4 py-3">Medications & Products</th>
                          <th className="px-4 py-3">Total</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Delivery & Tracking</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-800">
                        {profile.orders.map((order) => (
                          <tr key={order.id} className="hover:bg-slate-50/50">
                            <td className="px-4 py-3 font-mono font-semibold text-slate-900">{order.orderNumber}</td>
                            <td className="px-4 py-3 text-xs text-slate-600">
                              {new Date(order.placedAt).toLocaleDateString()}
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-medium text-slate-900">{order.medicationName || 'Wellness Item'}</p>
                              {order.items && order.items.length > 0 && (
                                <p className="text-xs text-slate-500">
                                  {order.items.map((i) => `${i.name} (x${i.quantity})`).join(', ')}
                                </p>
                              )}
                            </td>
                            <td className="px-4 py-3 font-semibold text-slate-900">
                              ${order.totalAmount.toFixed(2)}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                  order.status === 'Delivered'
                                    ? 'bg-blue-50 text-blue-800'
                                    : order.status === 'Cancelled'
                                    ? 'bg-rose-50 text-rose-800'
                                    : 'bg-blue-50 text-blue-800'
                                }`}
                              >
                                {order.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs">
                              {order.trackingNumber ? (
                                <span className="font-medium text-slate-700">
                                  {order.carrier || 'Carrier'}: <span className="font-mono">{order.trackingNumber}</span>
                                </span>
                              ) : (
                                <span className="text-slate-400">Processing</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
                    No current store orders are linked to this contact.
                  </p>
                )}
              </section>
            )}

            {profileActiveTab === 'orders' && profile.historicalOrders.length > 0 && (
              <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-4">
                  <h2 className="text-base font-bold text-slate-900">Imported Historical Orders</h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {profile.historicalOrders.length} historical record{profile.historicalOrders.length === 1 ? '' : 's'} from the source workbook. These are kept separate from current store orders.
                  </p>
                </div>
                <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
                  {profile.historicalOrders.map((order) => (
                    <article key={order.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900">
                            {order.items || 'Historical order'}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {order.orderNumber ? `Order ${order.orderNumber}` : 'Order number not recorded'}
                            {' · '}
                            {order.placedAt ? new Date(order.placedAt).toLocaleDateString() : 'Date not recorded'}
                            {order.sourceSheet ? ` · ${order.sourceSheet}` : ''}
                          </p>
                        </div>
                        {order.trackingNumber && (
                          <p className="text-xs font-medium text-slate-700">
                            {order.carrier || 'Tracking'}: <span className="font-mono">{order.trackingNumber}</span>
                          </p>
                        )}
                      </div>
                      {order.deliveryAddress && (
                        <p className="mt-2 text-xs text-slate-600">{order.deliveryAddress}</p>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            )}

            {profileActiveTab === 'source' && isSuperadmin && (
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-base font-bold text-slate-900">Imported source details</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Admin-only source rows retained for provenance. Payment and medical fields are not stored.
                </p>
                {profile.sourceRecords.length > 0 ? (
                  <div className="mt-4 max-h-[34rem] space-y-3 overflow-y-auto pr-1">
                    {profile.sourceRecords.map((record) => (
                      <article key={record.id} className="rounded-xl border border-slate-200 p-4">
                        <p className="text-xs font-semibold text-slate-800">
                          {record.sourceFile} · {record.sourceSheet} · Row {record.sourceRow}
                        </p>
                        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                          {Object.entries(record.data).map(([field, value]) => (
                            <div key={`${record.id}-${field}`} className="min-w-0 rounded-lg bg-slate-50 p-2.5">
                              <dt className="break-words text-[10px] font-semibold uppercase tracking-wide text-slate-400">{field}</dt>
                              <dd className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-700">{value || '—'}</dd>
                            </div>
                          ))}
                        </dl>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
                    No source workbook details have been retained for this contact.
                  </p>
                )}
              </section>
            )}

            {/* TAB 3: UNIFIED TIMELINE */}
            {profileActiveTab === 'timeline' && (
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-base font-bold text-slate-900">Chronological Customer History</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Unified feed of orders, stage changes, call outcomes, and staff notes.
                </p>

                <div className="mt-6 flow-root">
                  <ul className="-mb-8">
                    {combinedTimeline.map((item, index) => {
                      const isLast = index === combinedTimeline.length - 1;
                      if (item.type === 'order') {
                        const order = item.data;
                        return (
                          <li key={`order-${order.id}`}>
                            <div className="relative pb-8">
                              {!isLast && (
                                <span
                                  className="absolute left-4 top-4 -ml-px h-full w-0.5 bg-slate-200"
                                  aria-hidden="true"
                                />
                              )}
                              <div className="relative flex space-x-3">
                                <div>
                                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-800 ring-4 ring-white">
                                    <Package className="h-4 w-4" />
                                  </span>
                                </div>
                                <div className="flex min-w-0 flex-1 justify-between space-x-4 pt-1.5">
                                  <div>
                                    <p className="text-sm font-semibold text-slate-900">
                                      Order Placed: {order.orderNumber} (${order.totalAmount.toFixed(2)})
                                    </p>
                                    <p className="text-xs text-slate-500">
                                      {order.medicationName || 'Wellness purchase'} · {order.deliveryMethod}
                                    </p>
                                  </div>
                                  <div className="whitespace-nowrap text-right text-xs text-slate-400">
                                    <time>{new Date(order.placedAt).toLocaleDateString()}</time>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </li>
                        );
                      }

                      const activity = item.data;
                      const isStage = activity.type === 'status_change';
                      return (
                        <li key={`activity-${activity.id}`}>
                          <div className="relative pb-8">
                            {!isLast && (
                              <span
                                className="absolute left-4 top-4 -ml-px h-full w-0.5 bg-slate-200"
                                aria-hidden="true"
                              />
                            )}
                            <div className="relative flex space-x-3">
                              <div>
                                <span
                                  className={`flex h-8 w-8 items-center justify-center rounded-full ring-4 ring-white ${
                                    isStage
                                      ? 'bg-purple-100 text-purple-800'
                                      : 'bg-blue-100 text-blue-800'
                                  }`}
                                >
                                  {isStage ? <TrendingUp className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                                </span>
                              </div>
                              <div className="flex min-w-0 flex-1 justify-between space-x-4 pt-1.5">
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">
                                    {isStage
                                      ? `Stage transition: ${activity.fromStatus || 'Initial'} → ${activity.toStatus}`
                                      : 'Internal Staff Note'}
                                  </p>
                                  {activity.note && (
                                    <p className="mt-1 whitespace-pre-wrap text-xs text-slate-700">
                                      {activity.note}
                                    </p>
                                  )}
                                  <p className="mt-1 text-[11px] text-slate-400">
                                    Recorded by {activity.actorName || activity.actorEmail || 'Staff'}
                                  </p>
                                </div>
                                <div className="whitespace-nowrap text-right text-xs text-slate-400">
                                  <time>{new Date(activity.createdAt).toLocaleDateString()}</time>
                                </div>
                              </div>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </section>
            )}
          </>
        )}

        {/* EMAIL COMPOSER MODAL */}
        {emailComposerOpen && profile && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4"
            role="dialog"
            aria-modal="true"
          >
            <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
              <div className="flex items-start justify-between border-b border-slate-200 p-5">
                <div>
                  <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900">
                    <Mail className="h-5 w-5 text-blue-800" />
                    Compose Email to {profile.lead.firstName}
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Dispatched securely via connected Hostinger mail servers.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={emailSending}
                  onClick={() => setEmailComposerOpen(false)}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Quick Template Fill Buttons */}
              <div className="border-b border-slate-100 bg-slate-50 px-5 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Quick Fill Templates:</p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => applyEmailTemplate('welcome')}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Welcome Intro
                  </button>
                  <button
                    type="button"
                    onClick={() => applyEmailTemplate('order_followup')}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Order Check-in
                  </button>
                  <button
                    type="button"
                    onClick={() => applyEmailTemplate('consult')}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Consult Follow-up
                  </button>
                </div>
              </div>

              <form onSubmit={(e) => void sendLeadEmail(e)} className="space-y-4 p-5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Recipient</label>
                  <input
                    type="email"
                    readOnly
                    value={profile.lead.email}
                    className="mt-1 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Subject</label>
                  <input
                    required
                    maxLength={180}
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    placeholder="Subject line…"
                    className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Message</label>
                  <textarea
                    required
                    maxLength={10000}
                    rows={7}
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    placeholder="Write your email message…"
                    className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  />
                  {role !== 'admin' && (
                    <p className="mt-2 text-xs leading-5 text-slate-500">
                      Agent email is sent only to this lead. Additional recipients, attachments, email addresses, and phone numbers are not allowed.
                    </p>
                  )}
                </div>

                {!profile.lead.marketingConsent && (
                  <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    This contact has not explicitly opted into marketing email. Keep messages strictly operational or consultation-focused.
                  </p>
                )}

                {emailError && (
                  <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">{emailError}</p>
                )}

                <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                  <button
                    type="button"
                    disabled={emailSending}
                    onClick={() => setEmailComposerOpen(false)}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={emailSending || !emailSubject.trim() || !emailBody.trim()}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#1d4ed8] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#1e40af] disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {emailSending ? 'Sending…' : 'Send via Hostinger'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </section>
    );
  }

  // ----------------------------------------------------
  // RENDER: MAIN CRM HUB (TABLE & KANBAN PIPELINE)
  // ----------------------------------------------------
  return (
    <section className="space-y-6">
      {/* Notifications */}
      {dataError && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{dataError}</p>}
      {requestError && <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{requestError}</p>}
      {success && <p role="status" className="rounded-xl border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900">{success}</p>}
      {role === 'operator' && assignmentNotifications.length > 0 && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50/80 p-4 shadow-sm" role="status">
          <div className="flex items-center gap-2 text-sm font-bold text-blue-950">
            <Bell className="h-4 w-4" />
            <span>{assignmentNotifications.length} new lead assignment{assignmentNotifications.length === 1 ? '' : 's'}</span>
          </div>
          <ul className="mt-3 space-y-2">
            {assignmentNotifications.slice(0, 5).map((notification) => (
              <li key={notification.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-100 bg-white px-3 py-2">
                <span className="text-xs text-slate-700">
                  <strong>{`${notification.firstName} ${notification.lastName}`.trim() || 'A lead'}</strong>
                  {' '}was assigned by {notification.assignedByName} · {notification.status}
                </span>
                <button
                  type="button"
                  onClick={() => void openAssignmentNotification(notification)}
                  className="rounded-lg bg-blue-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-900"
                >
                  Open lead
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* TOP KPI COMMAND CENTER */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Contacts</span>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-800">
              <Users className="h-5 w-5" />
            </span>
          </div>
          <p className="mt-3 text-3xl font-extrabold text-slate-900">{totalLeadsCount}</p>
          <p className="mt-1 text-xs text-slate-500">Active customer & prospect directory</p>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Converted Customers</span>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-800">
              <Package className="h-5 w-5" />
            </span>
          </div>
          <p className="mt-3 text-3xl font-extrabold text-slate-900">{customersCount}</p>
          <p className="mt-1 text-xs text-slate-500">Contacts with completed orders</p>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Pipeline in Progress</span>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-50 text-purple-800">
              <Clock className="h-5 w-5" />
            </span>
          </div>
          <p className="mt-3 text-3xl font-extrabold text-slate-900">{needsFollowupCount}</p>
          <p className="mt-1 text-xs text-slate-500">Cold, Contacted & Qualified prospects</p>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Marketing Audience</span>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-800">
              <Mail className="h-5 w-5" />
            </span>
          </div>
          <p className="mt-3 text-3xl font-extrabold text-slate-900">{eligibleMarketingCount}</p>
          <p className="mt-1 text-xs text-slate-500">Opted in for Hostinger campaigns</p>
        </div>
      </div>

      {/* FILTER & CONTROL BAR */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        {/* Quick Segment Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setLeadTab('all');
                setLeadPage(1);
              }}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
                leadTab === 'all'
                  ? 'bg-blue-800 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
              }`}
            >
              All contacts ({leads.length})
            </button>
            {(isSuperadmin || canViewNewLeads) && (
              <button
                type="button"
                onClick={() => {
                  setLeadTab('unassigned');
                  setLeadPage(1);
                  setSelectedLeadIds([]);
                }}
                className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
                  leadTab === 'unassigned'
                    ? 'bg-blue-800 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                }`}
              >
                Unassigned ({unassignedLeadCount})
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setLeadTab('uncalled_repeat_buyers');
                setLeadPage(1);
              }}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
                leadTab === 'uncalled_repeat_buyers'
                  ? 'bg-blue-800 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
              }`}
            >
              Repeat Buyers ({leads.filter(isUncalledRepeatBuyer).length})
            </button>
            <button
              type="button"
              onClick={() => {
                setLeadTab('needs_followup');
                setLeadPage(1);
              }}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
                leadTab === 'needs_followup'
                  ? 'bg-blue-800 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
              }`}
            >
              In Pipeline ({needsFollowupCount})
            </button>
            <button
              type="button"
              onClick={() => {
                setLeadTab('opted_in');
                setLeadPage(1);
              }}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
                leadTab === 'opted_in'
                  ? 'bg-blue-800 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
              }`}
            >
              Email Opt-in ({eligibleMarketingCount})
            </button>
          </div>

          {/* Action Buttons: Add, Import, Export, View Toggle */}
          <div className="flex flex-wrap items-center gap-2">
            {isSuperadmin && leadTab === 'unassigned' && (
              <button
                type="button"
                onClick={() => void handleAutoAssignQueue()}
                disabled={batchUpdating || !tableFilteredLeads.length}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-800 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Users className="h-3.5 w-3.5" />
                {batchUpdating ? 'Assigning…' : `Auto-assign ${tableFilteredLeads.length} unassigned`}
              </button>
            )}
            {canAddContactsForRole && <button
              type="button"
              onClick={() => {
                setRequestError('');
                setMode('manual');
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#1d4ed8] px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[#1e40af]"
            >
              <UserPlus className="h-4 w-4" /> Add contact
            </button>}
            {canImportContactsForRole && <button
              type="button"
              onClick={() => {
                setRequestError('');
                setMode('csv');
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <Upload className="h-4 w-4" /> Import CSV
            </button>}
            {canExportContactsForRole && <button
              type="button"
              onClick={() => downloadContacts(filteredLeads)}
              disabled={!filteredLeads.length}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-40"
            >
              <Download className="h-4 w-4" /> Export CSV
            </button>}

            {/* View switcher: Table vs Kanban */}
            <div className="ml-2 flex rounded-xl border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setViewMode('table')}
                aria-label="Table view"
                className={`rounded-lg p-1.5 text-xs font-semibold transition ${
                  viewMode === 'table' ? 'bg-white text-blue-800 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                }`}
                title="Dense Data Table"
              >
                <TableIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('kanban')}
                aria-label="Kanban pipeline view"
                className={`rounded-lg p-1.5 text-xs font-semibold transition ${
                  viewMode === 'kanban' ? 'bg-white text-blue-800 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                }`}
                title="Visual Pipeline Kanban"
              >
                <Kanban className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Search, Country & Stage Filters */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setLeadPage(1);
              }}
              placeholder="Search by name, email, phone, or country…"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pl-10 pr-3.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              aria-label="Filter by stage"
              value={stageFilter}
              onChange={(e) => {
                setStageFilter(e.target.value as 'All' | LeadStatus);
                setLeadPage(1);
              }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 shadow-sm"
            >
              <option value="All">All stages</option>
              {STAGES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by country"
              value={countryFilter}
              onChange={(e) => {
                setCountryFilter(e.target.value);
                setLeadPage(1);
              }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 shadow-sm"
            >
              <option value="All">All countries</option>
              {availableCountries.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by contact details"
              value={contactTypeFilter}
              onChange={(e) => {
                setContactTypeFilter(e.target.value as 'All' | LeadContactCompleteness);
                setLeadPage(1);
              }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 shadow-sm"
            >
              <option value="All">All contact details</option>
              {(Object.keys(CONTACT_TYPE_LABELS) as LeadContactCompleteness[]).map((type) => (
                <option key={type} value={type}>
                  {CONTACT_TYPE_LABELS[type]} ({contactTypeCounts[type]})
                </option>
              ))}
            </select>

            {(search || stageFilter !== 'All' || countryFilter !== 'All' || contactTypeFilter !== 'All' || leadTab !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setStageFilter('All');
                  setCountryFilter('All');
                  setContactTypeFilter('All');
                  setLeadTab('all');
                }}
                className="rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* BATCH ACTION TOOLBAR (VISIBLE WHEN 1+ LEADS SELECTED) */}
        {selectedLeadIds.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-2.5 text-xs">
            <div className="flex items-center gap-2 font-semibold text-blue-900">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-800 text-[10px] font-bold text-white">
                {selectedLeadIds.length}
              </span>
              <span>contact{selectedLeadIds.length === 1 ? '' : 's'} selected</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 font-medium text-slate-700">
                Move to stage:
                <select
                  disabled={batchUpdating}
                  onChange={(e) => {
                    if (e.target.value) void handleBatchStageUpdate(e.target.value as LeadStatus);
                  }}
                  defaultValue=""
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                >
                  <option value="" disabled>
                    Select stage
                  </option>
                  {STAGES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>

              {isSuperadmin && (
                <label className="flex items-center gap-1.5 font-medium text-slate-700">
                  Assign agent:
                  <select
                    disabled={batchUpdating}
                    onChange={(e) => void handleBatchAgentAssign(e.target.value)}
                    defaultValue=""
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                  >
                    <option value="" disabled>
                      Assign staff
                    </option>
                    <option value="">Unassigned</option>
                    <option value="least_loaded">Least-loaded eligible agent</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.display_name || a.email} · {a.assigned_lead_count ?? 0} leads
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {canExportContactsForRole && <button
                type="button"
                onClick={() => {
                  const selectedContacts = leads.filter((l) => selectedLeadIds.includes(l.id));
                  downloadContacts(selectedContacts);
                }}
                className="rounded-lg border border-blue-300 bg-white px-2.5 py-1 font-semibold text-blue-800 hover:bg-blue-50"
              >
                Export selected
              </button>}

              <button
                type="button"
                onClick={() => setSelectedLeadIds([])}
                className="font-medium text-slate-500 hover:text-slate-800"
              >
                Deselect
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------------------- */}
      {/* VIEW 1: RESPONSIVE DATA TABLE */}
      {/* ------------------------------------------- */}
      {viewMode === 'table' && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/80 font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="w-10 px-4 py-3.5">
                    <input
                      type="checkbox"
                      checked={isAllVisibleSelected}
                      onChange={toggleSelectAll}
                      className="rounded border-slate-300 text-blue-800 cursor-pointer"
                      aria-label="Select all contacts on this page"
                    />
                  </th>
                  <th className="px-4 py-3.5">
                    <button
                      type="button"
                      onClick={() => handleToggleSort('name')}
                      className="inline-flex items-center gap-1 font-semibold uppercase tracking-wider text-slate-600 hover:text-slate-900 cursor-pointer"
                    >
                      <span>Name</span>
                      {sortField === 'name' ? (
                        sortOrder === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-[#1d4ed8]" /> : <ArrowDown className="h-3.5 w-3.5 text-[#1d4ed8]" />
                      ) : (
                        <ArrowUpDown className="h-3 w-3 text-slate-400 opacity-60" />
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-3.5">
                    <button
                      type="button"
                      onClick={() => handleToggleSort('email')}
                      className="inline-flex items-center gap-1 font-semibold uppercase tracking-wider text-slate-600 hover:text-slate-900 cursor-pointer"
                    >
                      <span>Email</span>
                      {sortField === 'email' ? (
                        sortOrder === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-[#1d4ed8]" /> : <ArrowDown className="h-3.5 w-3.5 text-[#1d4ed8]" />
                      ) : (
                        <ArrowUpDown className="h-3 w-3 text-slate-400 opacity-60" />
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-3.5">
                    <button
                      type="button"
                      onClick={() => handleToggleSort('completeness')}
                      title="Sort by populated name, contact, country, and address fields"
                      className="inline-flex items-center gap-1 font-semibold uppercase tracking-wider text-slate-600 hover:text-slate-900 cursor-pointer"
                    >
                      <span>Details</span>
                      {sortField === 'completeness' ? (
                        sortOrder === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-[#1d4ed8]" /> : <ArrowDown className="h-3.5 w-3.5 text-[#1d4ed8]" />
                      ) : (
                        <ArrowUpDown className="h-3 w-3 text-slate-400 opacity-60" />
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-3.5">Phone</th>
                  <th className="px-4 py-3.5">Address</th>
                  <th className="px-4 py-3.5">
                    <button
                      type="button"
                      onClick={() => handleToggleSort('country')}
                      className="inline-flex items-center gap-1 font-semibold uppercase tracking-wider text-slate-600 hover:text-slate-900 cursor-pointer"
                    >
                      <span>Country</span>
                      {sortField === 'country' ? (
                        sortOrder === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-[#1d4ed8]" /> : <ArrowDown className="h-3.5 w-3.5 text-[#1d4ed8]" />
                      ) : (
                        <ArrowUpDown className="h-3 w-3 text-slate-400 opacity-60" />
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-3.5">
                    <button
                      type="button"
                      onClick={() => handleToggleSort('stage')}
                      className="inline-flex items-center gap-1 font-semibold uppercase tracking-wider text-slate-600 hover:text-slate-900 cursor-pointer"
                    >
                      <span>Status</span>
                      {sortField === 'stage' ? (
                        sortOrder === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-[#1d4ed8]" /> : <ArrowDown className="h-3.5 w-3.5 text-[#1d4ed8]" />
                      ) : (
                        <ArrowUpDown className="h-3 w-3 text-slate-400 opacity-60" />
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-3.5">
                    <button
                      type="button"
                      onClick={() => handleToggleSort('orders')}
                      className="inline-flex items-center gap-1 font-semibold uppercase tracking-wider text-slate-600 hover:text-slate-900 cursor-pointer"
                    >
                      <span>Orders</span>
                      {sortField === 'orders' ? (
                        sortOrder === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-[#1d4ed8]" /> : <ArrowDown className="h-3.5 w-3.5 text-[#1d4ed8]" />
                      ) : (
                        <ArrowUpDown className="h-3 w-3 text-slate-400 opacity-60" />
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-3.5">Last Order</th>
                  {isSuperadmin && <th className="px-4 py-3.5">Assigned Agent</th>}
                  <th className="px-4 py-3.5 text-right">Actions</th>
                </tr>
                <tr className="border-t border-slate-200 bg-white normal-case tracking-normal">
                  <th className="px-2 py-2 text-center">
                    {hasTableFilters && (
                      <button
                        type="button"
                        onClick={clearTableFilters}
                        className="text-[10px] font-semibold text-blue-800 hover:underline"
                        aria-label="Clear table filters"
                      >
                        Clear
                      </button>
                    )}
                  </th>
                  <th className="px-2 py-2">
                    <input
                      value={tableFilters.name}
                      onChange={(event) => updateTableFilter('name', event.target.value)}
                      placeholder="Filter name"
                      aria-label="Filter table by name"
                      className="w-full min-w-24 rounded-md border border-slate-200 px-2 py-1.5 text-[11px] font-normal text-slate-700 placeholder:text-slate-400"
                    />
                  </th>
                  <th className="px-2 py-2">
                    <input
                      value={tableFilters.email}
                      onChange={(event) => updateTableFilter('email', event.target.value)}
                      placeholder="Filter email"
                      aria-label="Filter table by email"
                      className="w-full min-w-28 rounded-md border border-slate-200 px-2 py-1.5 text-[11px] font-normal text-slate-700 placeholder:text-slate-400"
                    />
                  </th>
                  <th className="px-2 py-2">
                    <select
                      value={tableFilters.details}
                      onChange={(event) => updateTableFilter('details', event.target.value)}
                      aria-label="Filter table by profile details score"
                      className="w-full min-w-16 rounded-md border border-slate-200 bg-white px-1.5 py-1.5 text-[11px] font-normal text-slate-700"
                    >
                      <option value="">All</option>
                      {Array.from({ length: maxProfileCompletenessScore + 1 }, (_, score) => (
                        <option key={score} value={score}>{score}/{maxProfileCompletenessScore}</option>
                      ))}
                    </select>
                  </th>
                  <th className="px-2 py-2">
                    <input
                      value={tableFilters.phone}
                      onChange={(event) => updateTableFilter('phone', event.target.value)}
                      placeholder="Filter phone"
                      aria-label="Filter table by phone"
                      className="w-full min-w-24 rounded-md border border-slate-200 px-2 py-1.5 text-[11px] font-normal text-slate-700 placeholder:text-slate-400"
                    />
                  </th>
                  <th className="px-2 py-2">
                    <input
                      value={tableFilters.address}
                      onChange={(event) => updateTableFilter('address', event.target.value)}
                      placeholder="Filter address"
                      aria-label="Filter table by address or postal code"
                      className="w-full min-w-28 rounded-md border border-slate-200 px-2 py-1.5 text-[11px] font-normal text-slate-700 placeholder:text-slate-400"
                    />
                  </th>
                  <th className="px-2 py-2">
                    <select
                      value={tableFilters.country}
                      onChange={(event) => updateTableFilter('country', event.target.value)}
                      aria-label="Filter table by country"
                      className="w-full min-w-28 rounded-md border border-slate-200 bg-white px-1.5 py-1.5 text-[11px] font-normal text-slate-700"
                    >
                      <option value="All">All countries</option>
                      {availableCountries.map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </th>
                  <th className="px-2 py-2">
                    <select
                      value={tableFilters.status}
                      onChange={(event) => updateTableFilter('status', event.target.value as 'All' | LeadStatus)}
                      aria-label="Filter table by status"
                      className="w-full min-w-24 rounded-md border border-slate-200 bg-white px-1.5 py-1.5 text-[11px] font-normal text-slate-700"
                    >
                      <option value="All">All statuses</option>
                      {STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
                    </select>
                  </th>
                  <th className="px-2 py-2">
                    <input
                      type="number"
                      min="0"
                      value={tableFilters.orders}
                      onChange={(event) => updateTableFilter('orders', event.target.value)}
                      placeholder="Count"
                      aria-label="Filter table by order count"
                      className="w-full min-w-16 rounded-md border border-slate-200 px-2 py-1.5 text-[11px] font-normal text-slate-700 placeholder:text-slate-400"
                    />
                  </th>
                  <th className="px-2 py-2">
                    <input
                      type="date"
                      value={tableFilters.lastOrder}
                      onChange={(event) => updateTableFilter('lastOrder', event.target.value)}
                      aria-label="Filter table by last order date"
                      className="w-full min-w-32 rounded-md border border-slate-200 px-1.5 py-1.5 text-[11px] font-normal text-slate-700"
                    />
                  </th>
                  {isSuperadmin && (
                    <th className="px-2 py-2">
                      <select
                        value={tableFilters.agent}
                        onChange={(event) => updateTableFilter('agent', event.target.value)}
                        aria-label="Filter table by assigned agent"
                        className="w-full min-w-28 rounded-md border border-slate-200 bg-white px-1.5 py-1.5 text-[11px] font-normal text-slate-700"
                      >
                        <option value="All">All agents</option>
                        <option value="unassigned">Unassigned</option>
                        {agents.map((agent) => (
                          <option key={agent.id} value={String(agent.id)}>{agent.display_name || agent.email}</option>
                        ))}
                      </select>
                    </th>
                  )}
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {visibleLeads.map((lead) => {
                  const stageObj = STAGES.find((s) => s.id === lead.status) || STAGES[0];
                  const isSelected = selectedLeadIds.includes(lead.id);

                  return (
                    <tr
                      key={lead.id}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
                        void openProfile(lead);
                      }}
                      className={`cursor-pointer transition hover:bg-slate-50/80 ${
                        isSelected ? 'bg-blue-50/40' : ''
                      }`}
                    >
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectOne(lead.id)}
                          className="rounded border-slate-300 text-blue-800"
                          aria-label={`Select ${lead.firstName} ${lead.lastName}`}
                        />
                      </td>

                      <td className="px-4 py-3 font-semibold text-blue-900">
                        <div className="flex items-center">
                          <span>{leadDisplayName(lead)}</span>
                          {(lead.firstName || lead.lastName) && copyButton(lead, 'name', `${lead.firstName} ${lead.lastName}`)}
                          <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                            {CONTACT_TYPE_LABELS[leadContactType(lead)]}
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3 font-mono text-slate-600">
                        <div className="flex items-center">
                          <span className="truncate max-w-[180px]">{lead.email || <span className="text-slate-400">Not provided</span>}</span>
                          {lead.email && copyButton(lead, 'email', lead.email)}
                        </div>
                      </td>

                      <td className="px-4 py-3 font-medium tabular-nums text-slate-600" aria-label={`${lead.profileCompletenessScore ?? calculateLeadProfileCompleteness(lead)} of ${lead.profileCompletenessMaxScore ?? 7} profile details`}>
                        {lead.profileCompletenessScore ?? calculateLeadProfileCompleteness(lead)}/{lead.profileCompletenessMaxScore ?? 7}
                      </td>

                      <td className="px-4 py-3">
                        {lead.phone ? (
                          <div className="flex items-center text-slate-800">
                            <span>{lead.phone}</span>
                            {copyButton(lead, 'phone', lead.phone)}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      <td className="max-w-[240px] px-4 py-3 text-slate-600" title={lead.address || ''}>
                        <span className="block truncate">{lead.address || '—'}</span>
                        {lead.postalCode && <span className="block text-xs text-slate-400">{lead.postalCode}</span>}
                      </td>

                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5">
                          <CountryFlag countryCode={getLeadCountryCode(lead.country ?? '', lead.phone)} />
                          <span>{getLeadCountryLabel(lead.country || '', lead.phone)}</span>
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${stageObj.bg} ${stageObj.text} border ${stageObj.border}`}
                        >
                          {lead.status}
                        </span>
                      </td>

                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {leadTab === 'uncalled_repeat_buyers' ? lead.activeOrderCount || 0 : lead.orderCount || 0}
                      </td>

                      <td className="px-4 py-3 text-slate-600">
                        {lead.lastOrderAt ? new Date(lead.lastOrderAt).toLocaleDateString() : '—'}
                      </td>

                      {isSuperadmin && (
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <select
                            aria-label={`Assign ${lead.firstName} ${lead.lastName}`}
                            value={lead.assignedStaffId ?? ''}
                            onChange={(e) => void handleSingleAgentAssign(lead.id, e.target.value)}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700"
                          >
                            <option value="">Unassigned</option>
                            {agents.map((agent) => (
                              <option key={agent.id} value={agent.id}>
                                {agent.display_name || agent.email} · {agent.assigned_lead_count ?? 0} leads
                              </option>
                            ))}
                          </select>
                        </td>
                      )}

                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => void openProfile(lead)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {!visibleLeads.length && (
                  <tr>
                    <td colSpan={isSuperadmin ? 12 : 11} className="px-6 py-12 text-center text-slate-400">
                      No contacts match the current filters or search query.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
            <span>
            Showing {sortedLeads.length ? (currentPage - 1) * pageSize + 1 : 0}–{Math.min(currentPage * pageSize, sortedLeads.length)} of{' '}
            {sortedLeads.length} contacts
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 font-medium text-slate-600">
                Rows per page
                <select
                  aria-label="Leads per page"
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    setLeadPage(1);
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700"
                >
                  {LEAD_PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setLeadPage(currentPage - 1)}
                className="rounded-lg border border-slate-200 px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                Previous
              </button>
              <span>
                Page {currentPage} of {pageCount}
              </span>
              <button
                type="button"
                disabled={currentPage >= pageCount}
                onClick={() => setLeadPage(currentPage + 1)}
                className="rounded-lg border border-slate-200 px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------- */}
      {/* VIEW 2: VISUAL KANBAN PIPELINE VIEW */}
      {/* ------------------------------------------- */}
      {viewMode === 'kanban' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          {STAGES.map((col) => {
            const columnLeads = filteredLeads.filter((l) => l.status === col.id);

            return (
              <div key={col.id} className="flex flex-col rounded-2xl border border-slate-200/90 bg-slate-50/70 p-3 shadow-sm">
                {/* Column Header */}
                <div className="flex items-center justify-between border-b border-slate-200/60 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold ${col.bg} ${col.text}`}
                    >
                      {col.label}
                    </span>
                  </div>
                  <span className="text-xs font-semibold text-slate-500">{columnLeads.length}</span>
                </div>

                {/* Column Cards */}
                <div className="mt-3 flex-1 space-y-2.5 overflow-y-auto max-h-[680px]">
                  {columnLeads.map((lead) => (
                    <article
                      key={lead.id}
                      onClick={() => void openProfile(lead)}
                      className="cursor-pointer rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition hover:border-blue-400 hover:shadow"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-bold text-slate-900 truncate">
                          {leadDisplayName(lead)}
                        </h4>
                        <CountryFlag countryCode={getLeadCountryCode(lead.country ?? '', lead.phone)} />
                      </div>

                      <p className="mt-1 truncate font-mono text-[11px] text-slate-500">
                        {lead.email || 'No email address'}
                      </p>
                      <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                        {CONTACT_TYPE_LABELS[leadContactType(lead)]}
                      </span>

                      <div className="mt-3 flex flex-wrap items-center justify-between gap-1 text-[11px] text-slate-500 border-t border-slate-100 pt-2.5">
                        <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                          <Package className="h-3 w-3 text-slate-400" />
                          {lead.orderCount || 0} order{lead.orderCount === 1 ? '' : 's'}
                        </span>

                        {lead.marketingConsent && (
                          <span className="text-[10px] font-semibold text-blue-700">Opted in</span>
                        )}
                      </div>

                      {/* Quick stage transition button */}
                      <div className="mt-2.5 flex items-center justify-between gap-1 pt-2 border-t border-slate-100/80" onClick={(e) => e.stopPropagation()}>
                        <span className="text-[10px] text-slate-400">Move:</span>
                        <select
                          value={lead.status}
                          onChange={(e) => {
                            if (onUpdateLead) void onUpdateLead(lead.id, { status: e.target.value as LeadStatus });
                          }}
                          className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-700"
                        >
                          {STAGES.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </article>
                  ))}

                  {!columnLeads.length && (
                    <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                      No contacts in this stage
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CSV & MANUAL ADD MODAL */}
      {mode && (mode === 'manual' ? canAddContactsForRole : canImportContactsForRole) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !saving) setMode(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
          >
            <header className="mb-5 flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {mode === 'csv' ? 'Import Contacts from CSV' : 'Create New Contact Lead'}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {mode === 'csv'
                    ? 'Import up to 20,000 unique contacts using email, phone, address, or postal code. Missing details stay blank; marketing consent is never assumed.'
                    : 'Add an individual customer or prospect to the CRM.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMode(null)}
                disabled={saving}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            {mode === 'csv' ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
                    <Upload className="h-4 w-4" /> Choose CSV File
                    <input type="file" accept=".csv,text/csv" className="sr-only" onChange={handleFile} />
                  </label>
                  <button
                    type="button"
                    onClick={downloadSample}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-800 hover:underline"
                  >
                    <Download className="h-3.5 w-3.5" /> Download Template
                  </button>
                </div>

                <textarea
                  value={csv}
                  onChange={(e) => parse(e.target.value)}
                  rows={5}
                  placeholder={'first_name,last_name,email,phone\nEleanor,Vance,eleanor@example.com,+15553491102'}
                  className="w-full rounded-xl border border-slate-300 p-3 font-mono text-xs focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                />

                {errors.map((err) => (
                  <p key={err} className="flex items-center gap-2 text-xs text-rose-700">
                    <AlertCircle className="h-4 w-4 shrink-0" /> {err}
                  </p>
                ))}

                {preview.length > 0 && (
                  <>
                    <div className="flex flex-wrap gap-2 text-[11px]">
                      {(Object.keys(CONTACT_TYPE_LABELS) as LeadContactCompleteness[])
                        .filter((type) => previewContactTypeCounts[type] > 0)
                        .map((type) => (
                          <span key={type} className="rounded-full bg-blue-50 px-2.5 py-1 font-medium text-blue-800">
                            {CONTACT_TYPE_LABELS[type]}: {previewContactTypeCounts[type]}
                          </span>
                        ))}
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 font-semibold text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Name</th>
                          <th className="px-3 py-2">Email</th>
                          <th className="px-3 py-2">Phone</th>
                          <th className="px-3 py-2">Consent</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {preview.slice(0, 10).map((p, i) => (
                          <tr key={`${p.email || p.phone}-${i}`}>
                            <td className="px-3 py-2">
                              {leadDisplayName(p)}
                            </td>
                            <td className="px-3 py-2 font-mono">{p.email || '—'}</td>
                            <td className="px-3 py-2">{p.phone || '—'}</td>
                            <td className="px-3 py-2">{p.marketingConsent ? 'Opted in' : 'No'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                    {historyPreview.length > 0 && (
                      <p className="text-xs font-medium text-slate-700">
                        The import also contains {historyPreview.length} historical order record{historyPreview.length === 1 ? '' : 's'} to attach to matching contacts.
                      </p>
                    )}
                    {isSuperadmin && sourceRecordsPreview.length > 0 && (
                      <p className="text-xs font-medium text-slate-700">
                        {sourceRecordsPreview.length} safe source detail record{sourceRecordsPreview.length === 1 ? '' : 's'} will be retained for admin-only review. Payment and medical fields are excluded.
                      </p>
                    )}
                  </>
                )}

                <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setMode(null)}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!preview.length || saving}
                    onClick={() => void save(preview, historyPreview, sourceRecordsPreview)}
                    className="rounded-xl bg-[#1d4ed8] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#1e40af] disabled:opacity-50"
                  >
                    {saving ? 'Importing…' : `Import ${preview.length} leads`}
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleManualSubmit} className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-700">
                  First name
                  <input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-xs font-semibold text-slate-700">
                  Last name
                  <input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-xs font-semibold text-slate-700">
                  Email address (optional)
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (!e.target.value.trim()) setMarketingConsent(false);
                    }}
                    className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-xs font-semibold text-slate-700">
                  Phone
                  <span className="mt-1 block">
                    <PhoneCountryInput value={phone} onChange={setPhone} />
                  </span>
                </label>
                <label className="text-xs font-semibold text-slate-700 sm:col-span-2">
                  Country
                  <span className="mt-1 block">
                    <CountrySelect value={country} onChange={setCountry} />
                  </span>
                </label>
                <label className="flex items-start gap-2 text-xs text-slate-700 sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={marketingConsent}
                    disabled={!email.trim()}
                    onChange={(e) => setMarketingConsent(e.target.checked)}
                    className="mt-0.5 rounded text-blue-800"
                  />
                  <span>Contact explicitly opted in to promotional and educational correspondence.</span>
                </label>
                <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 sm:col-span-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setMode(null)}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-xl bg-[#1d4ed8] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#1e40af] disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Save contact'}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
    </section>
  );
};
