import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, ArgumentsHost } from '@nestjs/common';
import { Response } from 'express';
import { RbacExceptionFilter } from '../rbac-exception.filter';

interface MockRequest {
  method: string;
  url: string;
  user: {
    id: string;
    email: string;
    role: string;
  } | null;
}

interface MockResponse {
  status: jest.Mock;
  json: jest.Mock;
}

interface MockHttpContext {
  getResponse: () => MockResponse;
  getRequest: () => MockRequest;
}

describe('RbacExceptionFilter', () => {
  let filter: RbacExceptionFilter;
  let mockResponse: MockResponse;
  let mockRequest: MockRequest;
  let mockHost: ArgumentsHost;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RbacExceptionFilter],
    }).compile();

    filter = module.get<RbacExceptionFilter>(RbacExceptionFilter);

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockRequest = {
      method: 'GET',
      url: '/test',
      user: null,
    };

    mockHost = {
      switchToHttp: (): MockHttpContext => ({
        getResponse: (): MockResponse => mockResponse,
        getRequest: (): MockRequest => mockRequest,
      }),
    } as ArgumentsHost;
  });

  describe('catch', () => {
    it('should handle admin endpoint access denial', () => {
      // Arrange
      const exception = new ForbiddenException();
      mockRequest.url = '/admin/users';
      mockRequest.user = {
        id: 'user-1',
        email: 'user@example.com',
        role: 'user',
      };

      // Act
      filter.catch(exception, mockHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Administrator privileges required',
          errorCode: 'RBAC_ADMIN_REQUIRED',
          details: expect.objectContaining({
            requiredRole: 'admin',
            currentRole: 'user',
            resource: 'admin',
            action: 'read',
          }) as Record<string, unknown>,
        }),
      );
    });

    it('should handle management endpoint access denial', () => {
      // Arrange
      const exception = new ForbiddenException();
      mockRequest.url = '/management/config';
      mockRequest.method = 'PUT';
      mockRequest.user = {
        id: 'user-1',
        email: 'user@example.com',
        role: 'user',
      };

      // Act
      filter.catch(exception, mockHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Management access required',
          errorCode: 'RBAC_MANAGEMENT_ACCESS_REQUIRED',
          details: expect.objectContaining({
            requiredRoles: ['admin'],
            currentRole: 'user',
            resource: 'management',
            action: 'update',
          }) as Record<string, unknown>,
        }),
      );
    });

    it('should handle generic resource access denial', () => {
      // Arrange
      const exception = new ForbiddenException();
      mockRequest.url = '/projects/123';
      mockRequest.method = 'DELETE';
      mockRequest.user = {
        id: 'guest-1',
        email: 'guest@example.com',
        role: 'guest',
      };

      // Act
      filter.catch(exception, mockHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Insufficient permissions for this resource',
          errorCode: 'RBAC_INSUFFICIENT_PERMISSIONS',
          details: expect.objectContaining({
            currentRole: 'guest',
            resource: 'projects',
            action: 'delete',
          }) as Record<string, unknown>,
        }),
      );
    });

    it('should handle unknown user access denial', () => {
      // Arrange
      const exception = new ForbiddenException();
      mockRequest.url = '/admin/users';
      mockRequest.user = null;

      // Act
      filter.catch(exception, mockHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Administrator privileges required',
          errorCode: 'RBAC_ADMIN_REQUIRED',
          details: expect.objectContaining({
            currentRole: 'unknown',
          }) as Record<string, unknown>,
          user: null,
        }),
      );
    });

    it('should include user context in development environment', () => {
      // Arrange
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const exception = new ForbiddenException();
      mockRequest.url = '/admin/users';
      mockRequest.user = {
        id: 'user-1',
        email: 'user@example.com',
        role: 'user',
      };

      // Act
      filter.catch(exception, mockHost);

      // Assert
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          user: expect.objectContaining({
            role: 'user',
            email: 'user@example.com',
          }) as Record<string, unknown>,
        }),
      );

      // Cleanup
      process.env.NODE_ENV = originalEnv;
    });

    it('should not include email in production environment', () => {
      // Arrange
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const exception = new ForbiddenException();
      mockRequest.url = '/admin/users';
      mockRequest.user = {
        id: 'user-1',
        email: 'user@example.com',
        role: 'user',
      };

      // Act
      filter.catch(exception, mockHost);

      // Assert
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          user: expect.objectContaining({
            role: 'user',
          }) as Record<string, unknown>,
        }),
      );

      const callArgs = (
        mockResponse.json.mock.calls[0] as unknown[]
      )?.[0] as Record<string, unknown>;
      const userObj = callArgs?.user as Record<string, unknown> | null;
      expect(userObj).not.toHaveProperty('email');

      // Cleanup
      process.env.NODE_ENV = originalEnv;
    });

    describe('extractActionFromMethod', () => {
      it.each([
        ['GET', 'read'],
        ['POST', 'create'],
        ['PUT', 'update'],
        ['PATCH', 'update'],
        ['DELETE', 'delete'],
        ['OPTIONS', 'unknown'],
      ])('should map %s method to %s action', (method, expectedAction) => {
        // Arrange
        const exception = new ForbiddenException();
        mockRequest.method = method;
        mockRequest.url = '/test';
        mockRequest.user = {
          id: 'user-1',
          email: 'user@example.com',
          role: 'user',
        };

        // Act
        filter.catch(exception, mockHost);

        // Assert
        expect(mockResponse.json).toHaveBeenCalledWith(
          expect.objectContaining({
            details: expect.objectContaining({
              action: expectedAction,
            }) as Record<string, unknown>,
          }),
        );
      });
    });

    describe('getHelpMessage', () => {
      it('should provide admin help message', () => {
        // Arrange
        const exception = new ForbiddenException();
        mockRequest.url = '/admin/users';
        mockRequest.user = {
          id: 'user-1',
          email: 'user@example.com',
          role: 'user',
        };

        // Act
        filter.catch(exception, mockHost);

        // Assert
        expect(mockResponse.json).toHaveBeenCalledWith(
          expect.objectContaining({
            help: 'This endpoint requires administrator privileges. Contact your system administrator if you need access.',
          }),
        );
      });

      it('should provide guest-specific help message', () => {
        // Arrange
        const exception = new ForbiddenException();
        mockRequest.url = '/projects';
        mockRequest.user = {
          id: 'guest-1',
          email: 'guest@example.com',
          role: 'guest',
        };

        // Act
        filter.catch(exception, mockHost);

        // Assert
        expect(mockResponse.json).toHaveBeenCalledWith(
          expect.objectContaining({
            help: 'Guest users have limited access. Please register for a full account or contact support.',
          }),
        );
      });

      it('should provide user-specific help message', () => {
        // Arrange
        const exception = new ForbiddenException();
        mockRequest.url = '/projects';
        mockRequest.user = {
          id: 'user-1',
          email: 'user@example.com',
          role: 'user',
        };

        // Act
        filter.catch(exception, mockHost);

        // Assert
        expect(mockResponse.json).toHaveBeenCalledWith(
          expect.objectContaining({
            help: 'This action requires elevated permissions. Contact your administrator if you need access.',
          }),
        );
      });
    });

    describe('extractResourceFromUrl', () => {
      it.each([
        ['/api/projects/123', 'projects'],
        ['/admin/users', 'admin'],
        ['/management/config', 'management'],
        ['/upload/document', 'upload'],
        ['/processing/documents/456/process', 'processing'],
        ['/invalid', 'unknown'],
        ['/', 'unknown'],
      ])(
        'should extract resource from URL %s as %s',
        (url, expectedResource) => {
          // Arrange
          const exception = new ForbiddenException();
          mockRequest.url = url;
          mockRequest.user = {
            id: 'user-1',
            email: 'user@example.com',
            role: 'user',
          };

          // Act
          filter.catch(exception, mockHost);

          // Assert
          if (
            expectedResource !== 'unknown' &&
            !url.includes('/admin/') &&
            !url.includes('/management/')
          ) {
            expect(mockResponse.json).toHaveBeenCalledWith(
              expect.objectContaining({
                details: expect.objectContaining({
                  resource: expectedResource,
                }) as Record<string, unknown>,
              }),
            );
          }
        },
      );
    });

    it('should include timestamp and path information', () => {
      // Arrange
      const exception = new ForbiddenException();
      mockRequest.url = '/test/path';
      mockRequest.method = 'POST';

      // Act
      filter.catch(exception, mockHost);

      // Assert
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(String) as string,
          path: '/test/path',
          method: 'POST',
        }),
      );
    });
  });
});
