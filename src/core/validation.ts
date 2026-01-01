import yaml from "yaml";
import type { PatchValidation, Validator } from "./config.js";

/**
 * Result of a validation check
 */
export interface ValidationError {
  file: string;
  validator: string;
  message: string;
}

/**
 * Result of running all validations
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Frontmatter regex - matches YAML frontmatter at the start of a file
 */
const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---/;

/**
 * Parse frontmatter from markdown content.
 */
function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(FRONTMATTER_REGEX);

  if (!match) {
    return null;
  }

  try {
    return yaml.parse(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Run a single validation check against content.
 * Returns an error message if validation fails, null if it passes.
 */
function runValidationCheck(
  content: string,
  validation: {
    notContains?: string;
    contains?: string;
    matches?: string;
    notMatches?: string;
    frontmatterRequired?: string[];
  }
): string | null {
  // notContains check
  if (validation.notContains !== undefined) {
    if (content.includes(validation.notContains)) {
      return `Contains '${validation.notContains}'`;
    }
  }

  // contains check
  if (validation.contains !== undefined) {
    if (!content.includes(validation.contains)) {
      return `Does not contain '${validation.contains}'`;
    }
  }

  // matches check (regex)
  if (validation.matches !== undefined) {
    const regex = new RegExp(validation.matches);
    if (!regex.test(content)) {
      return `Does not match pattern '${validation.matches}'`;
    }
  }

  // notMatches check (regex)
  if (validation.notMatches !== undefined) {
    const regex = new RegExp(validation.notMatches);
    if (regex.test(content)) {
      return `Matches forbidden pattern '${validation.notMatches}'`;
    }
  }

  // frontmatterRequired check
  if (validation.frontmatterRequired !== undefined && validation.frontmatterRequired.length > 0) {
    const frontmatter = parseFrontmatter(content);

    if (!frontmatter) {
      return `Missing required frontmatter fields: ${validation.frontmatterRequired.join(", ")}`;
    }

    const missingFields = validation.frontmatterRequired.filter(
      (field) => !(field in frontmatter)
    );

    if (missingFields.length > 0) {
      return `Missing required frontmatter fields: ${missingFields.join(", ")}`;
    }
  }

  return null;
}

/**
 * Run per-patch validation on content after a patch is applied.
 * Returns an error message if validation fails, null if it passes.
 */
export function runPatchValidation(
  content: string,
  validation: PatchValidation,
  _patchDescription: string
): string | null {
  if (!validation) {
    return null;
  }

  return runValidationCheck(content, validation);
}

/**
 * Run global validators on a file.
 * Returns a list of validation errors.
 */
export function runGlobalValidators(
  content: string,
  filePath: string,
  validators: Validator[]
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const validator of validators) {
    const errorMessage = runValidationCheck(content, validator);

    if (errorMessage) {
      errors.push({
        file: filePath,
        validator: validator.name,
        message: errorMessage,
      });
    }
  }

  return errors;
}

/**
 * Validate all files against global validators.
 */
export function validateFiles(
  files: Array<{ path: string; content: string }>,
  validators: Validator[]
): ValidationResult {
  const errors: ValidationError[] = [];

  for (const file of files) {
    const fileErrors = runGlobalValidators(file.content, file.path, validators);
    errors.push(...fileErrors);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
