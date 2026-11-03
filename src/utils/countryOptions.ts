import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

export interface CountryOption {
  code: CountryCode;
  name: string;
  callingCode: string;
  flag: string;
}

const toFlag = (code: string) => String.fromCodePoint(
  ...[...code.toUpperCase()].map((character) => 127397 + character.charCodeAt(0))
);

export const countryOptions: CountryOption[] = getCountries()
  .map((code) => ({
    code,
    name: regionNames.of(code) || code,
    callingCode: getCountryCallingCode(code),
    flag: toFlag(code),
  }))
  .sort((left, right) => left.name.localeCompare(right.name));

export function getLeadCountry(phone: string): string {
  const internationalPhone = phone.trim().startsWith('+') || phone.trim().startsWith('00');
  if (!internationalPhone) return 'Not specified';
  const parsed = parsePhoneNumberFromString(phone);
  if (parsed?.country) {
    return countryOptions.find((country) => country.code === parsed.country)?.name ?? 'Not specified';
  }
  const digits = phone.trim().replace(/^\+|^00/, '').replace(/\D/g, '');
  if (!digits) return 'Not specified';
  const matchingCountries = countryOptions.filter((country) => digits.startsWith(country.callingCode));
  const longestCode = Math.max(0, ...matchingCountries.map((country) => country.callingCode.length));
  const matches = matchingCountries.filter((country) => country.callingCode.length === longestCode);
  const commonCallingCodeNames: Record<string, string> = {
    '1': 'North America (+1)',
    '7': 'Russia / Kazakhstan (+7)',
    '44': 'United Kingdom',
  };
  if (commonCallingCodeNames[matches[0]?.callingCode]) return commonCallingCodeNames[matches[0].callingCode];
  if (matches.length === 1) return matches[0].name;
  if (matches.length > 1) return `Calling code +${matches[0].callingCode}`;
  return 'Not specified';
}

export function getLeadCountryCode(countryName: string, phone: string): CountryCode | '' {
  const countryLabel = countryName.trim();
  if (countryLabel && countryLabel !== 'Not specified') {
    return countryOptions.find((country) => country.name.toLowerCase() === countryLabel.toLowerCase())?.code ?? '';
  }

  const inferredCountry = countryOptions.find((country) => country.name === getLeadCountry(phone));
  if (inferredCountry) return inferredCountry.code;

  return parsePhoneNumberFromString(phone)?.country ?? '';
}

export function phoneInputParts(phone: string): { countryCode: CountryCode | ''; nationalNumber: string } {
  const parsed = parsePhoneNumberFromString(phone);
  if (parsed?.country) {
    return { countryCode: parsed.country, nationalNumber: parsed.nationalNumber };
  }
  if (phone.startsWith('+') || phone.startsWith('00')) {
    const digits = phone.trim().replace(/^\+|^00/, '').replace(/\D/g, '');
    const matchingCountries = countryOptions
      .filter((country) => digits.startsWith(country.callingCode))
      .sort((left, right) => right.callingCode.length - left.callingCode.length);
    const match = matchingCountries[0];
    if (match) {
      return { countryCode: match.code, nationalNumber: digits.slice(match.callingCode.length) };
    }
  }
  return {
    countryCode: '',
    nationalNumber: phone.replace(/\D/g, ''),
  };
}
