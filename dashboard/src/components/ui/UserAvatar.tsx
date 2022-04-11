import React from 'react';

import { useQuery } from '@apollo/client';
import { AvatarQuery, AvatarQueryVariables } from '../../types';
import gql from 'graphql-tag';
import Avatar from '@material-ui/core/Avatar';

interface Props {
	userId: number;
}

export const UserAvatar = (props: Props) => {
	const { data } = useQuery<AvatarQuery, AvatarQueryVariables>(
		gql`
			query Avatar($userId: Int!) {
				user(input: { id: $userId }) {
					name
					avatarUrl
				}
			}
		`,
		{
			variables: {
				userId: props.userId,
			},
			fetchPolicy: 'cache-and-network',
		},
	);

	return <Avatar variant='rounded' alt={data?.user?.name} src={data?.user?.avatarUrl} />;
};
