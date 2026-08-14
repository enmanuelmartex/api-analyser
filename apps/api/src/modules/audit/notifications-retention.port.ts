/**
 * The one thing the retention job needs from notifications.
 *
 * Declared here, in the module that consumes it, so the dependency points
 * audit → notifications and never back. NotificationsService implements it and
 * NotificationsModule binds it with `useExisting`; nothing in this module
 * imports a notifications type, which is what keeps the two modules
 * independently testable and free of a `forwardRef`.
 *
 * An abstract class rather than an interface because Nest resolves providers by
 * runtime token, and an interface does not survive compilation.
 */
export abstract class NotificationsRetentionPort {
  /**
   * Deletes read notifications created before `before`. Unread ones are kept
   * regardless of age: a notification the user has not seen is still pending
   * work, and silently discarding it is worse than an old row.
   *
   * @returns how many rows were removed.
   */
  abstract deleteReadOlderThan(before: Date): Promise<number>;
}
