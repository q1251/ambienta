import React, { useEffect, useRef, useState } from 'react';
import type { CountryCode } from 'libphonenumber-js';
import { Check, ChevronDown, Search } from 'lucide-react';
import { countryOptions, phoneInputParts, type CountryOption } from '../../utils/countryOptions';

interface CountryPickerProps {
  value: CountryCode | '';
  onChange: (value: CountryCode | '') => void;
  placeholder: string;
  ariaLabel: string;
  disabled?: boolean;
  selectedLabel?: string;
  showCallingCode?: boolean;
}

export const CountryFlag: React.FC<{ countryCode?: CountryCode | '' }> = ({ countryCode }) => (
  countryCode ? <span aria-hidden="true" className={`fi fi-${countryCode.toLowerCase()} shrink-0 rounded-sm`} /> : null
);

const CountryPicker: React.FC<CountryPickerProps> = ({
  value,
  onChange,
  placeholder,
  ariaLabel,
  disabled = false,
  selectedLabel,
  showCallingCode = false,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedCountry = countryOptions.find((country) => country.code === value);
  const visibleCountries = countryOptions.filter((country) =>
    `${country.name} ${country.code} ${country.callingCode}`.toLowerCase().includes(search.trim().toLowerCase()),
  );

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [open]);

  const chooseCountry = (country: CountryOption) => {
    onChange(country.code);
    setOpen(false);
    setSearch('');
  };

  return (
    <div className="relative min-w-0" ref={rootRef}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-10 w-full items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-900 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <CountryFlag countryCode={selectedCountry?.code} />
        <span className="min-w-0 flex-1 truncate">
          {selectedCountry
            ? showCallingCode ? `+${selectedCountry.callingCode}` : selectedCountry.name
            : selectedLabel || placeholder}
        </span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" />
      </button>
      {open && (
        <div role="dialog" aria-label={`Select ${ariaLabel.toLowerCase()}`} className="absolute left-0 top-full z-[70] mt-1 w-full min-w-64 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
          <label className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  setOpen(false);
                }
              }}
              aria-label={`Search ${ariaLabel.toLowerCase()}s`}
              placeholder="Search countries or codes"
              className="min-w-0 flex-1 border-0 p-0 text-sm outline-none focus:ring-0"
            />
          </label>
          <div role="group" aria-label={ariaLabel} className="max-h-60 overflow-y-auto p-1">
            {visibleCountries.map((country) => (
              <button
                key={country.code}
                type="button"
                aria-pressed={country.code === value}
                onClick={() => chooseCountry(country)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-slate-800 hover:bg-blue-50 focus-visible:bg-blue-50 focus-visible:outline-none"
              >
                <CountryFlag countryCode={country.code} />
                <span className="min-w-0 flex-1 truncate">{country.name}</span>
                {showCallingCode && <span className="text-slate-500">+{country.callingCode}</span>}
                {country.code === value && <Check aria-hidden="true" className="h-4 w-4 text-blue-800" />}
              </button>
            ))}
            {!visibleCountries.length && <p className="px-3 py-4 text-center text-sm text-slate-500">No countries found.</p>}
          </div>
        </div>
      )}
    </div>
  );
};

interface PhoneCountryInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export const PhoneCountryInput: React.FC<PhoneCountryInputProps> = ({ value, onChange, disabled = false }) => {
  const phoneParts = phoneInputParts(value);
  const [selectedCountryCode, setSelectedCountryCode] = useState<CountryCode | ''>(phoneParts.countryCode);
  const lastEmittedValue = useRef<string | null>(null);
  useEffect(() => {
    if (lastEmittedValue.current === value) {
      lastEmittedValue.current = null;
      return;
    }
    setSelectedCountryCode(phoneInputParts(value).countryCode);
  }, [value]);

  const updatePhone = (code: CountryCode | '', number: string) => {
    setSelectedCountryCode(code);
    const country = countryOptions.find((option) => option.code === code);
    const nationalDigits = number.replace(/\D/g, '');
    const nextValue = country && nationalDigits ? `+${country.callingCode} ${nationalDigits}` : nationalDigits;
    lastEmittedValue.current = nextValue;
    onChange(nextValue);
  };

  return (
    <div className="flex min-w-0">
      <div className="w-28 shrink-0">
        <CountryPicker
          value={selectedCountryCode}
          onChange={(code) => updatePhone(code, phoneParts.nationalNumber)}
          placeholder="Code"
          ariaLabel="Phone country calling code"
          disabled={disabled}
          showCallingCode
        />
      </div>
      <input
        aria-label="Phone number"
        type="tel"
        disabled={disabled}
        value={phoneParts.nationalNumber}
        onChange={(event) => updatePhone(selectedCountryCode, event.target.value)}
        placeholder="Phone number"
        className="min-w-0 flex-1 rounded-r-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-700"
      />
    </div>
  );
};

interface CountrySelectProps {
  value: string;
  onChange: (country: string) => void;
  disabled?: boolean;
}

export const CountrySelect: React.FC<CountrySelectProps> = ({ value, onChange, disabled = false }) => {
  const selectedOption = countryOptions.find((country) => country.name === value);
  return (
    <CountryPicker
      value={selectedOption?.code ?? ''}
      onChange={(code) => onChange(countryOptions.find((country) => country.code === code)?.name ?? '')}
      placeholder="Select country"
      selectedLabel={selectedOption ? undefined : value}
      ariaLabel="Country"
      disabled={disabled}
    />
  );
};
