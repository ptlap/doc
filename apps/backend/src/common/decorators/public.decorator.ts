import { SetMetadata } from '@nestjs/common';

export const isPublicKey = 'isPublic';
export const publicDecorator = () => SetMetadata(isPublicKey, true);
