"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type Role = "tenant" | "caretaker" | "custodian" | "admin" | "broker" | "system-admin";

export interface AuthUser {
  id: string;
  email?: string;
  name?: string;
  role: Role;
  privileges?: string[];
  /** "agent" for a caretaker the owner marked as their managing agent. */
  staffTitle?: string;
  managedByOwnerId?: string;
  /** Mobile number in E.164 form, e.g. "+254712345678". */
  phone?: string;
  /** WhatsApp number in E.164 form; empty means "same as phone". */
  whatsapp?: string;
  /** National ID number (PII — never exposed outside the owner's own session). */
  nationalId?: string;
  /** Non-secret account identifier (`CXXXXXX`); shown as plain text, never masked. */
  userCode?: string;
}

export interface ProfilePatch {
  name?: string;
  phone?: string;
  whatsapp?: string;
  nationalId?: string;
  password?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  refreshFailed: boolean;
  signIn: (identifier: string, password: string) => Promise<AuthUser>;
  signUp: (
    name: string,
    email: string,
    password: string,
    role: Role,
    details: { phone: string; nationalId: string },
  ) => Promise<void>;
  resendVerification: (email: string) => Promise<void>;
  updateProfile: (patch: ProfilePatch) => Promise<boolean>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshFailed, setRefreshFailed] = useState(false);

  // Tracks whether this provider instance has ever held an authenticated
  // session. A 401 from /api/auth/me only signals an *expired* session when
  // the visitor was actually signed in during this page lifecycle; a stale
  // cookie left over from a previous visit (or an anonymous visitor) must not
  // surface a misleading "Session expired" toast on the login/auth pages.
  const hadSessionRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        // `user: null` means the visitor is anonymous — a normal state on the
        // login page and right after signing out, not an expired session.
        const nextUser = (data.user ?? null) as AuthUser | null;
        setUser(nextUser);
        if (nextUser) hadSessionRef.current = true;
        setRefreshFailed(false);
        return;
      }
      setUser(null);
      setRefreshFailed(true);
      if (
        res.status === 401 &&
        hadSessionRef.current &&
        typeof window !== "undefined" &&
        window.location.pathname.startsWith("/dashboard")
      ) {
        toast.error("Session expired", { description: "Please sign in again." });
      }
    } catch {
      setUser(null);
      setRefreshFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signIn = async (identifier: string, password: string): Promise<AuthUser> => {
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "signin", identifier, password }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Sign in failed");
      }
      const data = await res.json();
      const signedInUser = data.user as AuthUser;
      setUser(signedInUser);
      hadSessionRef.current = true;
      toast.success("Welcome back!");
      return signedInUser;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign in failed";
      toast.error("Sign in failed", { description: message });
      throw err;
    }
  };

  const signUp = async (
    name: string,
    email: string,
    password: string,
    role: Role,
    details: { phone: string; nationalId: string },
  ) => {
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "signup",
          name,
          email,
          password,
          role,
          phone: details.phone,
          nationalId: details.nationalId,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Sign up failed");
      }
      toast.success("Account created!");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign up failed";
      toast.error("Sign up failed", { description: message });
      throw err;
    }
  };

  const resendVerification = async (email: string) => {
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resend-verification", email }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to resend verification email");
      }
      toast.success("Verification email sent");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to resend verification email";
      toast.error("Resend failed", { description: message });
      throw err;
    }
  };

  const updateProfile = async (patch: ProfilePatch): Promise<boolean> => {
    try {
      const res = await fetch("/api/v1/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update profile");
      }
      const data = await res.json();
      setUser((current) =>
        current ? { ...current, ...(data.data as Partial<AuthUser>) } : data.data,
      );
      toast.success("Profile updated");
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update profile";
      toast.error("Update failed", { description: message });
      return false;
    }
  };

  const signOut = async () => {
    try {
      await fetch("/api/auth/logout", { method: "GET" });
    } catch {
      /* ignore */
    } finally {
      setUser(null);
      setRefreshFailed(false);
      hadSessionRef.current = false;
      toast.success("Signed out successfully");
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        refreshFailed,
        signIn,
        signUp,
        resendVerification,
        updateProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
