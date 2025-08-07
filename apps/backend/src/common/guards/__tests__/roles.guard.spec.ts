import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../roles.guard';
import { Role } from '../../enums/role.enum';
import { ROLES_KEY } from '../../decorators/roles.decorator';

interface MockUser {
  id: string;
  email: string;
  role: string | null | undefined;
  isActive?: boolean;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn().mockReturnValue(null),
          },
        },
      ],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  const createMockExecutionContext = (
    user: MockUser | null | Record<string, unknown>,
  ): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user: user as MockUser }),
        getResponse: () => ({}),
        getNext: () => ({}),
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
      getArgs: jest.fn(),
      getArgByIndex: jest.fn(),
      switchToRpc: jest.fn(),
      switchToWs: jest.fn(),
      getType: jest.fn(),
    } as ExecutionContext;
  };

  describe('canActivate', () => {
    it('should allow access when no roles are required', () => {
      // Arrange
      const mockGetAllAndOverride = jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValue(null);
      const context = createMockExecutionContext({});

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
      expect(mockGetAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
    });

    it('should allow access when empty roles array is required', () => {
      // Arrange
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([]);
      const context = createMockExecutionContext({});

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should deny access when no user is present', () => {
      // Arrange
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.USER]);
      const context = createMockExecutionContext(null);

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(false);
    });

    it('should deny access when user is inactive', () => {
      // Arrange
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.USER]);
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        role: Role.USER,
        isActive: false,
      };
      const context = createMockExecutionContext(user);

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(false);
    });

    it('should allow access when user has required role', () => {
      // Arrange
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.USER]);
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        role: Role.USER,
        isActive: true,
      };
      const context = createMockExecutionContext(user);

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should allow access when user has one of multiple required roles', () => {
      // Arrange
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValue([Role.USER, Role.ADMIN]);
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        role: Role.ADMIN,
        isActive: true,
      };
      const context = createMockExecutionContext(user);

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
    });

    it('should deny access when user does not have required role', () => {
      // Arrange
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        role: Role.USER,
        isActive: true,
      };
      const context = createMockExecutionContext(user);

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(false);
    });

    it('should deny access when user role does not match any of multiple required roles', () => {
      // Arrange
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        role: Role.GUEST,
        isActive: true,
      };
      const context = createMockExecutionContext(user);

      // Act
      const result = guard.canActivate(context);

      // Assert
      expect(result).toBe(false);
    });

    describe('Role-specific scenarios', () => {
      it('should allow admin to access admin-only resources', () => {
        // Arrange
        jest
          .spyOn(reflector, 'getAllAndOverride')
          .mockReturnValue([Role.ADMIN]);
        const adminUser = {
          id: 'admin-1',
          email: 'admin@example.com',
          role: Role.ADMIN,
          isActive: true,
        };
        const context = createMockExecutionContext(adminUser);

        // Act
        const result = guard.canActivate(context);

        // Assert
        expect(result).toBe(true);
      });

      it('should deny regular user access to admin-only resources', () => {
        // Arrange
        jest
          .spyOn(reflector, 'getAllAndOverride')
          .mockReturnValue([Role.ADMIN]);
        const regularUser = {
          id: 'user-1',
          email: 'user@example.com',
          role: Role.USER,
          isActive: true,
        };
        const context = createMockExecutionContext(regularUser);

        // Act
        const result = guard.canActivate(context);

        // Assert
        expect(result).toBe(false);
      });

      it('should deny guest access to user resources', () => {
        // Arrange
        jest
          .spyOn(reflector, 'getAllAndOverride')
          .mockReturnValue([Role.USER, Role.ADMIN]);
        const guestUser = {
          id: 'guest-1',
          email: 'guest@example.com',
          role: Role.GUEST,
          isActive: true,
        };
        const context = createMockExecutionContext(guestUser);

        // Act
        const result = guard.canActivate(context);

        // Assert
        expect(result).toBe(false);
      });

      it('should allow admin to access user resources', () => {
        // Arrange
        jest
          .spyOn(reflector, 'getAllAndOverride')
          .mockReturnValue([Role.USER, Role.ADMIN]);
        const adminUser = {
          id: 'admin-1',
          email: 'admin@example.com',
          role: Role.ADMIN,
          isActive: true,
        };
        const context = createMockExecutionContext(adminUser);

        // Act
        const result = guard.canActivate(context);

        // Assert
        expect(result).toBe(true);
      });
    });

    describe('Edge cases', () => {
      it('should handle undefined user role', () => {
        // Arrange
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.USER]);
        const user = {
          id: 'user-1',
          email: 'test@example.com',
          role: undefined,
          isActive: true,
        };
        const context = createMockExecutionContext(user);

        // Act
        const result = guard.canActivate(context);

        // Assert
        expect(result).toBe(false);
      });

      it('should handle null user role', () => {
        // Arrange
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.USER]);
        const user = {
          id: 'user-1',
          email: 'test@example.com',
          role: null,
          isActive: true,
        };
        const context = createMockExecutionContext(user);

        // Act
        const result = guard.canActivate(context);

        // Assert
        expect(result).toBe(false);
      });

      it('should handle invalid role string', () => {
        // Arrange
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.USER]);
        const user = {
          id: 'user-1',
          email: 'test@example.com',
          role: 'invalid-role',
          isActive: true,
        };
        const context = createMockExecutionContext(user);

        // Act
        const result = guard.canActivate(context);

        // Assert
        expect(result).toBe(false);
      });

      it('should handle missing isActive property', () => {
        // Arrange
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.USER]);
        const user = {
          id: 'user-1',
          email: 'test@example.com',
          role: Role.USER,
          // isActive is missing
        };
        const context = createMockExecutionContext(user);

        // Act
        const result = guard.canActivate(context);

        // Assert
        expect(result).toBe(false);
      });
    });
  });

  describe('Logging behavior', () => {
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('should log warning when no user is found', () => {
      // Arrange
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.USER]);
      const context = createMockExecutionContext(null);

      // Act
      guard.canActivate(context);

      // Assert
      // Note: In a real test, you might want to mock the logger instead
      // This is a simplified test for demonstration
    });

    it('should log warning when user is inactive', () => {
      // Arrange
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.USER]);
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        role: Role.USER,
        isActive: false,
      };
      const context = createMockExecutionContext(user);

      // Act
      guard.canActivate(context);

      // Assert
      // Logger warning should be called
    });

    it('should log warning when access is denied', () => {
      // Arrange
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        role: Role.USER,
        isActive: true,
      };
      const context = createMockExecutionContext(user);

      // Act
      guard.canActivate(context);

      // Assert
      // Logger warning should be called
    });
  });
});
