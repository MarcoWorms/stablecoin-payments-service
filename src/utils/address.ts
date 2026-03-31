import { getAddress, isAddress } from "viem";

export function normalizeAddress(input: string): `0x${string}` {
  if (!isAddress(input)) {
    throw new Error(`Invalid EVM address: ${input}`);
  }

  return getAddress(input);
}
