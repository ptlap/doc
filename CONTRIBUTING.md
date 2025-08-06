# Contributing to AI Document Assistant

Cảm ơn bạn đã quan tâm đến việc đóng góp cho dự án AI Document Assistant! Tài liệu này sẽ hướng dẫn bạn quy trình đóng góp và các quy tắc cần tuân thủ.

## 📋 Mục lục

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Pull Request Process](#pull-request-process)
- [Issue Guidelines](#issue-guidelines)
- [Release Process](#release-process)

## 🤝 Code of Conduct

Dự án này tuân thủ [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/). Bằng việc tham gia, bạn đồng ý tuân thủ các quy tắc này.

### Nguyên tắc cơ bản:
- **Tôn trọng**: Đối xử tôn trọng với mọi người
- **Bao dung**: Chấp nhận quan điểm và kinh nghiệm khác nhau
- **Hợp tác**: Làm việc cùng nhau để đạt mục tiêu chung
- **Chuyên nghiệp**: Duy trì thái độ chuyên nghiệp trong mọi tương tác

## 🚀 Getting Started

### Prerequisites

Đảm bảo bạn đã cài đặt:

```bash
# Node.js (v18+)
node --version

# pnpm (v8+)
pnpm --version

# Git
git --version

# Docker (optional, for local development)
docker --version
```

### Setup Development Environment

1. **Fork và clone repository**
```bash
# Fork repo trên GitHub, sau đó clone
git clone https://github.com/YOUR_USERNAME/ai-document-assistant.git
cd ai-document-assistant

# Add upstream remote
git remote add upstream https://github.com/ORIGINAL_OWNER/ai-document-assistant.git
```

2. **Install dependencies**
```bash
# Install all dependencies
pnpm install

# Setup git hooks
pnpm prepare
```

3. **Environment setup**
```bash
# Copy environment files
cp apps/frontend/.env.local.example apps/frontend/.env.local
cp apps/backend/.env.example apps/backend/.env

# Edit environment variables
# Thêm API keys và database URLs cần thiết
```

4. **Database setup**
```bash
# Start database (Docker)
cd tools/docker
docker-compose -f docker-compose.dev.yml up -d postgres redis

# Run migrations
cd ../../apps/backend
npx prisma generate
npx prisma db push
npx prisma db seed
```

5. **Start development servers**
```bash
# Root directory
pnpm dev

# Hoặc start riêng từng service
pnpm dev:frontend  # http://localhost:3000
pnpm dev:backend   # http://localhost:3001
```

### Verify Setup

```bash
# Run tests
pnpm test

# Run linting
pnpm lint

# Build project
pnpm build
```

## 🔄 Development Workflow

### Branch Strategy

Chúng tôi sử dụng **Git Flow** với các loại branch:

```bash
main                    # Production-ready code
├── develop            # Integration branch
├── feature/           # New features
│   ├── feature/upload-ui
│   ├── feature/ocr-processing
│   └── feature/chat-interface
├── bugfix/            # Bug fixes
│   ├── bugfix/file-validation
│   └── bugfix/memory-leak
├── hotfix/            # Critical production fixes
│   └── hotfix/security-patch
└── release/           # Release preparation
    └── release/v1.0.0
```

### Working on Features

1. **Create feature branch**
```bash
# Sync with upstream
git checkout develop
git pull upstream develop

# Create feature branch
git checkout -b feature/your-feature-name

# Hoặc cho bugfix
git checkout -b bugfix/issue-description
```

2. **Development cycle**
```bash
# Make changes
# Write tests
# Run tests locally
pnpm test

# Lint and format
pnpm lint
pnpm format

# Commit changes (see commit guidelines below)
git add .
git commit -m "feat: add file upload validation"

# Push to your fork
git push origin feature/your-feature-name
```

3. **Keep branch updated**
```bash
# Regularly sync with develop
git checkout develop
git pull upstream develop
git checkout feature/your-feature-name
git rebase develop

# Resolve conflicts if any
# Force push after rebase
git push --force-with-lease origin feature/your-feature-name
```

### Commit Message Guidelines

Chúng tôi sử dụng [Conventional Commits](https://www.conventionalcommits.org/):

```bash
# Format
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

#### Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks
- `perf`: Performance improvements
- `ci`: CI/CD changes

#### Examples:
```bash
# Good commits
feat(upload): add file type validation
fix(ocr): resolve memory leak in worker threads
docs(api): update authentication endpoints
test(chat): add integration tests for message flow
refactor(components): extract reusable button component
chore(deps): update dependencies to latest versions

# Bad commits
fix: bug fix                    # Too vague
update files                    # No type, unclear
WIP: working on feature         # Not descriptive
```

#### Scope Guidelines:
- `frontend`: Frontend-specific changes
- `backend`: Backend-specific changes
- `api`: API-related changes
- `ui`: UI component changes
- `auth`: Authentication/authorization
- `upload`: File upload functionality
- `ocr`: OCR processing
- `chat`: Chat/messaging features
- `db`: Database changes
- `config`: Configuration changes

## 📏 Coding Standards

### Style Guide Compliance

Tất cả code phải tuân thủ [Style Guide](./STYLE_GUIDE.md). Các điểm chính:

1. **Naming Conventions**
   - Variables/Functions: `camelCase`
   - Classes/Interfaces: `PascalCase`
   - Constants: `SCREAMING_SNAKE_CASE`
   - Files: `kebab-case.tsx`

2. **Code Organization**
   - Import order: built-ins → external → internal → relative
   - Export named exports over default exports
   - Group related functionality

3. **TypeScript**
   - Explicit types for public APIs
   - Avoid `any`, use `unknown` when needed
   - Proper error handling with custom error types

### Automated Checks

```bash
# Pre-commit hooks automatically run:
pnpm lint          # ESLint checks
pnpm format        # Prettier formatting
pnpm type-check    # TypeScript compilation
pnpm test:changed  # Tests for changed files

# Manual checks
pnpm lint:fix      # Auto-fix linting issues
pnpm format:check  # Check formatting without fixing
```

## 🧪 Testing Guidelines

### Testing Strategy

1. **Unit Tests** - Individual functions/components
2. **Integration Tests** - Module interactions
3. **E2E Tests** - Complete user workflows

### Writing Tests

```typescript
// ✅ Good test structure
describe('FileUpload Component', () => {
  // Arrange - Setup
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('when valid file is uploaded', () => {
    it('should process file and show progress', async () => {
      // Arrange
      const mockFile = new File(['content'], 'test.pdf');
      const onSuccess = jest.fn();
      
      // Act
      render(<FileUpload onSuccess={onSuccess} />);
      await userEvent.upload(screen.getByLabelText(/upload/i), mockFile);
      
      // Assert
      expect(screen.getByText(/processing/i)).toBeInTheDocument();
      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(
          expect.objectContaining({ fileName: 'test.pdf' })
        );
      });
    });
  });

  describe('when invalid file is uploaded', () => {
    it('should show error message', async () => {
      // Test implementation
    });
  });
});
```

### Test Requirements

- **Coverage**: Minimum 80% code coverage
- **Naming**: Descriptive test names
- **Isolation**: Tests should not depend on each other
- **Mocking**: Mock external dependencies
- **Assertions**: Clear and specific assertions

### Running Tests

```bash
# All tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage report
pnpm test:coverage

# Specific test file
pnpm test file-upload.test.tsx

# E2E tests
pnpm test:e2e
```

## 📝 Pull Request Process

### Before Creating PR

1. **Self Review**
   - [ ] Code follows style guide
   - [ ] Tests are written and passing
   - [ ] Documentation is updated
   - [ ] No debugging code left
   - [ ] Performance considerations addressed

2. **Local Testing**
```bash
# Run full test suite
pnpm test

# Check linting
pnpm lint

# Build successfully
pnpm build

# E2E tests (if applicable)
pnpm test:e2e
```

### Creating Pull Request

1. **PR Title**: Follow conventional commit format
```
feat(upload): add drag-and-drop file upload
fix(chat): resolve message ordering issue
docs(api): update authentication documentation
```

2. **PR Description Template**:
```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update

## Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] E2E tests pass (if applicable)
- [ ] Manual testing completed

## Screenshots (if applicable)
Add screenshots for UI changes

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] No breaking changes (or clearly documented)

## Related Issues
Closes #123
Related to #456
```

### PR Review Process

1. **Automated Checks**
   - CI/CD pipeline must pass
   - All tests must pass
   - Code coverage maintained
   - No linting errors

2. **Code Review**
   - At least 1 reviewer approval required
   - Address all review comments
   - Update PR based on feedback

3. **Merge Requirements**
   - All checks passing ✅
   - Approved by reviewer(s) ✅
   - Up-to-date with target branch ✅
   - No merge conflicts ✅

### Merge Strategy

- **Squash and Merge**: For feature branches
- **Merge Commit**: For release branches
- **Rebase and Merge**: For small fixes

## 🐛 Issue Guidelines

### Bug Reports

Use the bug report template:

```markdown
**Bug Description**
Clear description of the bug

**Steps to Reproduce**
1. Go to '...'
2. Click on '....'
3. Scroll down to '....'
4. See error

**Expected Behavior**
What you expected to happen

**Actual Behavior**
What actually happened

**Screenshots**
If applicable, add screenshots

**Environment**
- OS: [e.g. macOS, Windows, Linux]
- Browser: [e.g. Chrome, Firefox, Safari]
- Version: [e.g. 1.0.0]

**Additional Context**
Any other context about the problem
```

### Feature Requests

```markdown
**Feature Description**
Clear description of the feature

**Problem Statement**
What problem does this solve?

**Proposed Solution**
How should this feature work?

**Alternatives Considered**
Other solutions you've considered

**Additional Context**
Any other context or screenshots
```

### Issue Labels

- `bug`: Something isn't working
- `enhancement`: New feature or request
- `documentation`: Improvements or additions to documentation
- `good first issue`: Good for newcomers
- `help wanted`: Extra attention is needed
- `priority:high`: High priority
- `priority:medium`: Medium priority
- `priority:low`: Low priority

## 🚀 Release Process

### Version Numbering

Chúng tôi sử dụng [Semantic Versioning](https://semver.org/):

- `MAJOR.MINOR.PATCH` (e.g., 1.2.3)
- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes (backward compatible)

### Release Workflow

1. **Prepare Release**
```bash
# Create release branch
git checkout develop
git pull upstream develop
git checkout -b release/v1.2.0

# Update version numbers
# Update CHANGELOG.md
# Final testing
```

2. **Release Checklist**
   - [ ] All features tested
   - [ ] Documentation updated
   - [ ] CHANGELOG.md updated
   - [ ] Version numbers updated
   - [ ] Migration scripts ready (if needed)
   - [ ] Deployment scripts tested

3. **Create Release**
```bash
# Merge to main
git checkout main
git merge release/v1.2.0

# Tag release
git tag -a v1.2.0 -m "Release version 1.2.0"
git push upstream main --tags

# Merge back to develop
git checkout develop
git merge main
git push upstream develop
```

## 🛠 Development Tools

### Recommended VS Code Extensions

```json
{
  "recommendations": [
    "esbenp.prettier-vscode",
    "dbaeumer.vscode-eslint",
    "bradlc.vscode-tailwindcss",
    "ms-vscode.vscode-typescript-next",
    "ms-playwright.playwright",
    "prisma.prisma",
    "ms-vscode.vscode-json"
  ]
}
```

### Useful Commands

```bash
# Development
pnpm dev                    # Start all services
pnpm dev:frontend          # Start frontend only
pnpm dev:backend           # Start backend only

# Testing
pnpm test                  # Run all tests
pnpm test:watch           # Watch mode
pnpm test:coverage        # Coverage report
pnpm test:e2e             # E2E tests

# Code Quality
pnpm lint                 # Run ESLint
pnpm lint:fix             # Fix linting issues
pnpm format               # Format with Prettier
pnpm type-check           # TypeScript check

# Database
pnpm db:generate          # Generate Prisma client
pnpm db:push              # Push schema changes
pnpm db:migrate           # Run migrations
pnpm db:seed              # Seed database
pnpm db:studio            # Open Prisma Studio

# Build
pnpm build                # Build all apps
pnpm build:frontend       # Build frontend
pnpm build:backend        # Build backend

# Utilities
pnpm clean                # Clean build artifacts
pnpm reset                # Reset node_modules
```

## 📚 Resources

### Documentation
- [Style Guide](./STYLE_GUIDE.md) - Coding standards and conventions
- [API Documentation](./docs/api/) - API endpoints and schemas
- [Architecture Guide](./docs/architecture/) - System design and architecture

### External Resources
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [React Documentation](https://react.dev/)
- [Next.js Documentation](https://nextjs.org/docs)
- [NestJS Documentation](https://docs.nestjs.com/)
- [Prisma Documentation](https://www.prisma.io/docs)

### Community
- [GitHub Discussions](https://github.com/OWNER/REPO/discussions) - General discussions
- [Issues](https://github.com/OWNER/REPO/issues) - Bug reports and feature requests

## ❓ Getting Help

### Before Asking for Help

1. Check existing [documentation](./docs/)
2. Search [existing issues](https://github.com/OWNER/REPO/issues)
3. Check [discussions](https://github.com/OWNER/REPO/discussions)

### How to Ask for Help

1. **GitHub Discussions** - General questions and discussions
2. **GitHub Issues** - Bug reports and feature requests
3. **Code Review** - Ask questions in PR comments

### Providing Context

When asking for help, include:
- What you're trying to achieve
- What you've tried
- Error messages (full stack trace)
- Environment details
- Minimal reproduction case

---

## 🙏 Thank You

Cảm ơn bạn đã đóng góp cho AI Document Assistant! Mọi đóng góp, dù lớn hay nhỏ, đều được đánh giá cao và giúp làm cho dự án tốt hơn cho tất cả mọi người.

**Happy Coding! 🚀**