# Regex Tester Skill

## Purpose
Test and validate regex patterns with multiple test cases. Useful for validating SN codes, barcodes, and other patterned strings.

## Usage
When user asks to test regex, test patterns, validate rules, or similar.

## Regex Test Template

```python
import re

def test_regex(pattern: str, test_cases: list) -> dict:
    """
    Test a regex pattern against multiple test cases.
    
    Args:
        pattern: regex pattern string
        test_cases: list of strings to test
    
    Returns:
        dict with 'valid' (bool), 'error' (str or None), 'results' (list of tuples)
    """
    results = []
    try:
        regex = re.compile(pattern)
        for sn in test_cases:
            match = bool(regex.match(sn))
            results.append((sn, match))
        return {'valid': True, 'error': None, 'results': results}
    except re.error as e:
        return {'valid': False, 'error': str(e), 'results': []}

# Example: PCBA code validation
pcba_pattern = r'^5G\d{7}[A-Z]$'
pcba_tests = ['5G5608888A', '5G560888', '5G5608888AA', '5G5608888A1']
result = test_regex(pcba_pattern, pcba_tests)
for sn, matched in result['results']:
    icon = '✅' if matched else '❌'
    print(f'{icon} {sn}')

# Example: Shell code validation  
shell_pattern = r'^NV18A[A-Z0-9]{9}$'
shell_tests = ['NV18A2619K2371', 'NV18A2619K23', '123456']
result = test_regex(shell_pattern, shell_tests)
for sn, matched in result['results']:
    icon = '✅' if matched else '❌'
    print(f'{icon} {sn}')
```

## Common Patterns

### Alphanumeric Codes
- `^[A-Z0-9]{n}$` - Exactly n characters, uppercase letters and digits
- `^[A-Z]\d{n}$` - Letter followed by n digits
- `^\d{4}[A-Z]{4}$` - 4 digits followed by 4 letters

### Date/Time Formats
- `^\d{4}-\d{2}-\d{2}$` - YYYY-MM-DD
- `^\d{2}:\d{2}:\d{2}$` - HH:MM:SS

### Chinese Barcodes
- `^[A-Z]{2}\d{8}$` - 2 letters + 8 digits
- `^5G\d{7}[A-Z]$` - PCBA format
- `^NV18A[A-Z0-9]{9}$` - Shell format

## Notes
- Always escape special regex characters with `\\` in Python strings
- Use `re.match()` for prefix matching, `re.fullmatch()` for complete match
- Empty pattern `""` matches everything but use with caution
