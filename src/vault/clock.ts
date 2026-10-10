// The clock the vault layer reads: every write and read that needs today or the time asks here.

export function now(): Date {
	return new Date();
}
