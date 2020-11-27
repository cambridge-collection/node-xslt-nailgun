export interface Result {
  success: boolean;
  error: string | undefined;
}

export function name(potentialName: string): Result;
export function qname(potentialQname: string): Result;
