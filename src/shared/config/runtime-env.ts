import {
  parseDatabaseEnvironment,
  parseEnvironment,
  parseRedisEnvironment,
  parseServiceEnvironment,
} from "@/shared/config/environment";

export const runtimeEnv = parseEnvironment();

let serviceEnvironment: ReturnType<typeof parseServiceEnvironment> | undefined;
let databaseEnvironment: ReturnType<typeof parseDatabaseEnvironment> | undefined;
let redisEnvironment: ReturnType<typeof parseRedisEnvironment> | undefined;

export function getServiceEnvironment() {
  serviceEnvironment ??= parseServiceEnvironment();
  return serviceEnvironment;
}

export function getDatabaseEnvironment() {
  databaseEnvironment ??= parseDatabaseEnvironment();
  return databaseEnvironment;
}

export function getRedisEnvironment() {
  redisEnvironment ??= parseRedisEnvironment();
  return redisEnvironment;
}
