import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  account: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
