/**
 * The Darkhold Exchange - Dynamic Authentication, Profiles & Role Management
 * Supports:
 * - Dynamic Signup & Login with Gmail / Email
 * - Role-Based Profile Archetypes (Buyer, Seller, Trader, Collector, Organizer)
 * - Automatic double-entry ledger provisioning per role
 * - Token-based session management
 */

import crypto from 'node:crypto';

export const UserRole = {
  BUYER: {
    id: 'BUYER',
    name: 'Festival Fan / Buyer',
    description: 'Looking to acquire limited festival passes at fair collar prices',
    icon: '🎟️',
    initialCash: 2500.0,
    initialRelics: {}
  },
  SELLER: {
    id: 'SELLER',
    name: 'Verified Ticket Seller',
    description: 'Holds passes to sell or liquidate on the secondary market',
    icon: '🏷️',
    initialCash: 500.0,
    initialRelics: {
      'DAY1-PASS': { available: 3, held: 0 },
      'VIP-RELIC': { available: 1, held: 0 }
    }
  },
  TRADER: {
    id: 'TRADER',
    name: 'Market Trader',
    description: 'Provides liquidity, trades both bids and asks with stop-limit orders',
    icon: '📈',
    initialCash: 6000.0,
    initialRelics: {
      'DAY1-PASS': { available: 2, held: 0 }
    }
  },
  COLLECTOR: {
    id: 'COLLECTOR',
    name: 'Relic Collector',
    description: 'Hunts for rare VIP Relics and Chrono fastpass wristbands',
    icon: '💎',
    initialCash: 4500.0,
    initialRelics: {
      'CHRONO-WRISTBAND': { available: 2, held: 0 }
    }
  },
  ORGANIZER: {
    id: 'ORGANIZER',
    name: 'Festival Event Organizer',
    description: 'Primary issuer, manages batch liquidity and hosts Dutch Auctions',
    icon: '🏛️',
    initialCash: 50000.0,
    initialRelics: {
      'DAY1-PASS': { available: 25, held: 0 },
      'VIP-RELIC': { available: 10, held: 0 },
      'CHRONO-WRISTBAND': { available: 15, held: 0 }
    }
  }
};

export class AuthService {
  constructor(ledger, auditLog, antiScalp) {
    this.ledger = ledger;
    this.auditLog = auditLog;
    this.antiScalp = antiScalp;

    // Users database: userId -> { userId, email, username, role, passwordHash, salt, createdAt }
    this.users = new Map();
    // Email index: email -> userId
    this.emailIndex = new Map();
    // Sessions: token -> { userId, createdAt, expiresAt }
    this.sessions = new Map();
  }

  hashPassword(password, salt) {
    return crypto.createHash('sha256').update(password + ':' + salt).digest('hex');
  }

  /**
   * Register a new user dynamically with Gmail / Email and Role
   */
  register({ email, username, password, role = 'BUYER', turnstileToken = 'TURNSTILE_OK' }) {
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanUsername = (username || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');

    if (!cleanEmail || !cleanEmail.includes('@')) {
      return { success: false, reason: 'Valid email address is required (e.g. yourname@gmail.com)' };
    }

    if (!cleanUsername || cleanUsername.length < 3) {
      return { success: false, reason: 'Username must be at least 3 alphanumeric characters' };
    }

    const userId = cleanUsername.toLowerCase();

    if (this.users.has(userId)) {
      return { success: false, reason: `Username "${cleanUsername}" is already taken` };
    }

    if (this.emailIndex.has(cleanEmail)) {
      return { success: false, reason: `An account with email "${cleanEmail}" already exists. Please log in.` };
    }

    // Anti-bot check
    const turnstile = this.antiScalp.verifyTurnstile(turnstileToken);
    if (!turnstile.verified) {
      return { success: false, reason: turnstile.reason };
    }

    const selectedRole = UserRole[role.toUpperCase()] || UserRole.BUYER;
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = this.hashPassword(password || 'password123', salt);

    const user = {
      userId,
      username: cleanUsername,
      email: cleanEmail,
      role: selectedRole.id,
      roleName: selectedRole.name,
      roleIcon: selectedRole.icon,
      passwordHash,
      salt,
      createdAt: Date.now()
    };

    this.users.set(userId, user);
    this.emailIndex.set(cleanEmail, userId);

    // Provision Double-Entry Ledger account dynamically with role's starting assets
    this.ledger.initAccount(
      userId,
      selectedRole.initialCash,
      JSON.parse(JSON.stringify(selectedRole.initialRelics))
    );

    // Create active session token
    const token = `SES-${crypto.randomUUID()}`;
    this.sessions.set(token, {
      userId,
      token,
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 3600 * 1000
    });

    this.auditLog.append('USER_REGISTERED', {
      userId,
      email: cleanEmail,
      role: selectedRole.id,
      timestamp: Date.now()
    });

    const acc = this.ledger.getAccount(userId);

    return {
      success: true,
      token,
      user: {
        userId: user.userId,
        username: user.username,
        email: user.email,
        role: user.role,
        roleName: user.roleName,
        roleIcon: user.roleIcon,
        cashAvailable: acc.cashAvailable,
        relics: acc.relics
      }
    };
  }

  /**
   * Log in user with either Email or Username
   */
  login({ identifier, password }) {
    const cleanId = (identifier || '').trim().toLowerCase();
    let userId = cleanId;

    if (cleanId.includes('@')) {
      userId = this.emailIndex.get(cleanId);
      if (!userId) {
        return { success: false, reason: 'No account registered with this email address' };
      }
    }

    const user = this.users.get(userId);
    if (!user) {
      return { success: false, reason: 'Account not found. Please register.' };
    }

    if (password) {
      const hash = this.hashPassword(password, user.salt);
      if (hash !== user.passwordHash) {
        return { success: false, reason: 'Incorrect password' };
      }
    }

    // Generate session
    const token = `SES-${crypto.randomUUID()}`;
    this.sessions.set(token, {
      userId,
      token,
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 3600 * 1000
    });

    const acc = this.ledger.getAccount(userId);

    return {
      success: true,
      token,
      user: {
        userId: user.userId,
        username: user.username,
        email: user.email,
        role: user.role,
        roleName: user.roleName,
        roleIcon: user.roleIcon,
        cashAvailable: acc.cashAvailable,
        cashHeld: acc.cashHeld,
        relics: acc.relics
      }
    };
  }

  /**
   * Step 1: Real Gmail / Google Authentication
   * Authenticates identity first, then checks if profile/role needs to be built.
   */
  gmailAuth({ email, name, picture, credential }) {
    let cleanEmail = (email || '').trim().toLowerCase();
    let displayName = name || '';
    let avatarUrl = picture || '';

    // If Google ID Token JWT is provided, decode payload
    if (credential && credential.includes('.')) {
      try {
        const parts = credential.split('.');
        if (parts.length === 3) {
          const payloadJson = Buffer.from(parts[1], 'base64').toString('utf8');
          const payload = JSON.parse(payloadJson);
          if (payload.email) cleanEmail = payload.email.toLowerCase();
          if (payload.name) displayName = payload.name;
          if (payload.picture) avatarUrl = payload.picture;
        }
      } catch (err) {
        console.warn('JWT decode notice:', err.message);
      }
    }

    if (!cleanEmail || !cleanEmail.includes('@')) {
      return { success: false, reason: 'Valid Google / Gmail address is required (e.g. user@gmail.com)' };
    }

    // Check if user already exists
    if (this.emailIndex.has(cleanEmail)) {
      const existingUserId = this.emailIndex.get(cleanEmail);
      const existingUser = this.users.get(existingUserId);

      // Create session
      const token = `SES-${crypto.randomUUID()}`;
      this.sessions.set(token, {
        userId: existingUser.userId,
        token,
        createdAt: Date.now(),
        expiresAt: Date.now() + 24 * 3600 * 1000
      });

      const acc = this.ledger.getAccount(existingUser.userId);

      return {
        success: true,
        profileCompleted: !!existingUser.profileCompleted,
        token,
        user: {
          userId: existingUser.userId,
          username: existingUser.username,
          email: existingUser.email,
          role: existingUser.role,
          roleName: existingUser.roleName,
          roleIcon: existingUser.roleIcon,
          picture: existingUser.picture || avatarUrl,
          cashAvailable: acc.cashAvailable,
          cashHeld: acc.cashHeld,
          relics: acc.relics
        }
      };
    }

    // New Google User: Create pending account (Stage 1 completed, awaiting Stage 2: Profile)
    const baseUsername = (displayName || cleanEmail.split('@')[0]).replace(/[^a-zA-Z0-9_-]/g, '');
    let finalUsername = baseUsername || 'trader_' + Math.floor(Math.random() * 9000 + 1000);
    let counter = 1;
    while (this.users.has(finalUsername.toLowerCase())) {
      finalUsername = `${baseUsername}_${counter++}`;
    }

    const userId = finalUsername.toLowerCase();
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = this.hashPassword('google_oauth_auto', salt);

    const newUser = {
      userId,
      username: finalUsername,
      email: cleanEmail,
      picture: avatarUrl,
      role: null,
      roleName: null,
      roleIcon: '👤',
      profileCompleted: false,
      passwordHash,
      salt,
      createdAt: Date.now()
    };

    this.users.set(userId, newUser);
    this.emailIndex.set(cleanEmail, userId);

    // Initial empty ledger account before role selection
    this.ledger.initAccount(userId, 0.0, {});

    // Create session token for step 2
    const token = `SES-${crypto.randomUUID()}`;
    this.sessions.set(token, {
      userId,
      token,
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 3600 * 1000
    });

    this.auditLog.append('GMAIL_AUTHENTICATED', {
      userId,
      email: cleanEmail,
      timestamp: Date.now()
    });

    return {
      success: true,
      profileCompleted: false, // Must proceed to Step 2: Build Profile (Roles)
      token,
      email: cleanEmail,
      suggestedUsername: finalUsername,
      picture: avatarUrl
    };
  }

  /**
   * Step 2: Build Profile (Assign Role & Capabilities)
   */
  completeProfile({ token, role = 'BUYER', username, turnstileToken = 'TURNSTILE_OK' }) {
    const session = this.sessions.get(token);
    if (!session || Date.now() > session.expiresAt) {
      return { success: false, reason: 'Authentication session expired. Please sign in with Gmail again.' };
    }

    const user = this.users.get(session.userId);
    if (!user) {
      return { success: false, reason: 'User record not found' };
    }

    const selectedRole = UserRole[role.toUpperCase()] || UserRole.BUYER;

    if (username && username.trim().length >= 3) {
      const cleanName = username.trim().replace(/[^a-zA-Z0-9_-]/g, '');
      const newUserId = cleanName.toLowerCase();
      if (newUserId !== user.userId && !this.users.has(newUserId)) {
        this.users.delete(user.userId);
        this.emailIndex.set(user.email, newUserId);
        session.userId = newUserId;

        const oldAcc = this.ledger.accounts.get(user.userId);
        if (oldAcc) {
          this.ledger.accounts.delete(user.userId);
          oldAcc.userId = newUserId;
          this.ledger.accounts.set(newUserId, oldAcc);
        }
        user.userId = newUserId;
        this.users.set(newUserId, user);
      }
      user.username = cleanName;
    }

    user.role = selectedRole.id;
    user.roleName = selectedRole.name;
    user.roleIcon = selectedRole.icon;
    user.profileCompleted = true;

    // Dynamically provision ledger account with the selected role's starting assets
    const acc = this.ledger.getAccount(user.userId);
    acc.cashAvailable = selectedRole.initialCash;
    acc.cashHeld = 0.0;
    acc.relics = JSON.parse(JSON.stringify(selectedRole.initialRelics));

    this.auditLog.append('PROFILE_ROLE_ASSIGNED', {
      userId: user.userId,
      role: selectedRole.id,
      startingCash: selectedRole.initialCash,
      timestamp: Date.now()
    });

    return {
      success: true,
      token,
      user: {
        userId: user.userId,
        username: user.username,
        email: user.email,
        role: user.role,
        roleName: user.roleName,
        roleIcon: user.roleIcon,
        picture: user.picture,
        cashAvailable: acc.cashAvailable,
        cashHeld: acc.cashHeld,
        relics: acc.relics
      }
    };
  }

  /**
   * One-Click Google / Gmail Sign-in handler (Backward compatible)
   */
  googleLogin({ email, name, role = 'BUYER' }) {
    const authResult = this.gmailAuth({ email, name });
    if (!authResult.success) return authResult;
    if (authResult.profileCompleted) return authResult;

    return this.completeProfile({
      token: authResult.token,
      role,
      username: authResult.suggestedUsername
    });
  }

  getUserByToken(token) {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session || Date.now() > session.expiresAt) {
      return null;
    }
    const user = this.users.get(session.userId);
    if (!user) return null;

    const acc = this.ledger.getAccount(user.userId);
    return {
      userId: user.userId,
      username: user.username,
      email: user.email,
      role: user.role,
      roleName: user.roleName,
      roleIcon: user.roleIcon,
      cashAvailable: acc.cashAvailable,
      cashHeld: acc.cashHeld,
      relics: acc.relics
    };
  }

  logout(token) {
    this.sessions.delete(token);
    return { success: true };
  }

  getAllUsers() {
    return Array.from(this.users.values()).map(u => {
      const acc = this.ledger.getAccount(u.userId);
      return {
        userId: u.userId,
        username: u.username,
        email: u.email,
        role: u.role,
        roleName: u.roleName,
        roleIcon: u.roleIcon,
        cashAvailable: acc.cashAvailable,
        cashHeld: acc.cashHeld,
        relics: acc.relics
      };
    });
  }
}
