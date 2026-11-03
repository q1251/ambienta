import React, { useEffect, useRef, useState } from 'react';
import type { CountryCode } from 'libphonenumber-js';
import { countryOptions, phoneInputParts } from '../../utils/countryOptions';

interface PhoneCountryInputProps {
  value: string;
  onChange: (value: string) => void;
  defaultCountryName?: string;
  disabled?: boolean;
}

export const PhoneCountryInput: React.FC<PhoneCountryInputProps> = ({ value, onChange, defaultCountryName = '', disabled = false }) => {
  const phoneParts = phoneInputParts(value, defaultCountryName);
  const [selectedCountryCode, setSelectedCountryCode] = useState<CountryCode | ''>(phoneParts.countryCode);
  const lastEmittedValue = useRef<string | null>(null);
  useEffect(() => {
    if (lastEmittedValue.current === value) {
      lastEmittedValue.current = null;
      return;
    }
    setSelectedCountryCode(phoneInputParts(value, defaultCountryName).countryCode);
  }, [value, defaultCountryName]);
  const selectedCountry = countryOptions.find((country) => country.code === selectedCountryCode);

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
      <label className="sr-only" htmlFor="lead-phone-country-code">Phone country calling code</label>
      <select
        id="lead-phone-country-code"
        aria-label="Phone country calling code"
        disabled={disabled}
        value={selectedCountryCode}
        onChange={(event) => updatePhone(event.target.value as CountryCode | '', phoneParts.nationalNumber)}
        className="max-w-[9.5rem] rounded-l-md border border-r-0 border-slate-300 bg-slate-50 px-2 py-2 text-sm disabled:opacity-60"
      >
        <option value="">Code</option>
        {countryOptions.map((country) => (
          <option key={country.code} value={country.code}>{country.flag} {country.name} (+{country.callingCode})</option>
        ))}
      </select>
      <input
        aria-label="Phone number"
        type="tel"
        disabled={disabled}
        value={phoneParts.nationalNumber}
        onChange={(event) => updatePhone(selectedCountryCode, event.target.value)}
        placeholder="Phone number"
        className="min-w-0 flex-1 rounded-r-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-700"
      />
      {selectedCountry && <span className="sr-only">Selected calling code +{selectedCountry.callingCode}</span>}
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
    <select
      aria-label="Country"
      disabled={disabled}
      value={selectedOption?.code ?? (value ? 'other' : '')}
      onChange={(event) => {
        const country = countryOptions.find((option) => option.code === event.target.value);
        onChange(country?.name ?? '');
      }}
      className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-700"
    >
      <option value="">Select country</option>
      {value && !selectedOption && <option value="other">{value}</option>}
      {countryOptions.map((country) => (
        <option key={country.code} value={country.code}>{country.flag} {country.name}</option>
      ))}
    </select>
  );
};
